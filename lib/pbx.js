'use strict';

const
	STATE_NONE = 0,
	STATE_IS_AUTH = 1,
	MSG_LEN_7_BIT = 160,
	MSG_LEN_8_BIT = 70,

	EventEmmiter = require('events'),
	modNet = require('net');


class PBX extends EventEmmiter {

	constructor() {
		super();

		this.on('response', this._onResponse);

		this.state = STATE_NONE;

		this._packageBuffer = '';
	}


	_onResponse(data) {
		if ('follows' === data.type.toLowerCase())
			this.emit('response-follows', data);

		if (data.fields.ActionID)
			this.emit('action-id-' + data.fields.ActionID, data);
	}


	/**
	 * Обработать накопленный в буфере блока ответа
	 * @param {String} str
	 * */
	_applyPackageBuffer(str) {
		str = str.trim();

		if (!str)
			return;

		this.debug && console.log('\r\n---package:start---\r\n' + str + '\r\n---package:end---\r\n');

		let msgParsed = this._parseMsg(str);

		if (str.match(/^Asterisk Call Manager/ig))
			this.emit('connect');

		if ('authentication accepted' === (msgParsed.Message || '').toLowerCase())
			this.emit('login-success');

		if ('authentication failed' === (msgParsed.Message || '').toLowerCase())
			this.emit('login-fail');

		if (msgParsed.Event) {
			this.emit('event', {
				type: msgParsed.Event,
				raw: str,
				fields: msgParsed
			});
		}

		if (msgParsed.Response) {
			this.emit('response', {
				type: msgParsed.Response,
				raw: str,
				fields: msgParsed
			})
		}
	}


	_onRawData(msg) {
		msg += '';

		this.debug && console.log('\r\n---e:data:start---\r\n' + msg + '\r\n---e:data:end---\r\n');

		for (let c = 0; c < msg.length; c++) {
			if (
				msg[c] === '\r'
				&& msg[c + 1] === '\n'
				&& msg[c + 2] === '\r'
				&& msg[c + 3] === '\n'
			) {
				this._applyPackageBuffer(this._packageBuffer);
				this._packageBuffer = '';
				continue;
			}

			this._packageBuffer += msg[c];
		}
	}


	_parseMsg(str) {
		return str.split(/\n{1}/ig).reduce((prev, line, arr, fld, val) => {
			return Object.assign(
				prev,
				([ fld = '', val = '' ] = line.split(': ')) && { [fld.trim()]: val.trim() }
			);
		}, {});
	}


	/**
	 * Отправить комманду в АТС
	 * @param {Object} fields
	 * @return {Promise}
	 * */
	send(fields) {
		let str = '',
			keys = Object.keys(fields);

		if (!keys.length)
			return Promise.reject('EgPBX.send(): fields argument are empty');

		keys.forEach(key => str += key + ': ' + fields[key] + '\r\n');

		str += '\r\n';

		this._soc.write(str);

		return Promise.resolve();
	}


	/**
	 * Установить соединение с АТС
	 * */
	connect(arg) {
		this._packageBuffer = '';

		this._soc = modNet.createConnection({
			port: arg.port,
			host: arg.host
		}, function() {
			// ...
		});

		this._soc.on('data', this._onRawData.bind(this));

		this._soc.on('end', () => {
			this._soc.destroy();
		});

		return this;
	}


	/**
	 * Разорвать соединение с АТС
	 * */
	disconnect() {
		this._soc.end('');
		this._soc.destroy();
		this._soc.unref();

		return this;
	}


	/**
	 * Авторизировать пользователя
	 * @param {String} arg.usr - пользователь
	 * @param {String} arg.pwd - пароль
	 * @return {Promise}
	 * */
	login(arg = {}) {
		let timer,
			{ timeout = 15000 } = arg;

		let reset = () => {
			clearTimeout(timer);
			this.removeAllListeners('login-success');
			this.removeAllListeners('login-fail');
		};

		return Promise.race([
			new Promise((resolve, reject) => {
				this.once('login-success', () => {
					this.state = STATE_IS_AUTH;

					reset(); resolve();
				});

				this.once('login-fail', () => {
					reset(); reject('MBPX.login(): login-fail');
				});

				this.send({
					action: 'login',
					username: arg.usr,
					secret: arg.pwd
				});
			}),
			new Promise((r, reject) => {
				timer = setTimeout(() => {
					reset();
					reject('MBPX.login(): timeout');
				}, timeout);
			})
		]);
	}


	/**
	 * Получить информацию о GSM слотах
	 * @return {Promise}
	 * */
	gsmShowSpans(arg = {}) {
		return new Promise((resolve, reject) => {
			if (this.state !== STATE_IS_AUTH)
				return reject('!STATE_IS_AUTH');

			let actionId = arg.actionId || Math.random() + '';

			this.once('action-id-' + actionId, (data) => {
				let spans = Object.keys(data.fields).reduce((prev, key) => {
					let val = data.fields[key];

					val = val.trim();

					if (!key.match(/^GSM/))
						return prev;

					val = val.split(/,\s?/ig);

					let spanId = key.match(/\d+$/)[0];

					return Object.assign(
						prev,
						{
							[spanId]: {
								span:           spanId,
								powerStatus:    val[0].split(' ')[1],
								provisioned:    val[1],
								cardStatus:     val[2],
								isActive:       'active' === val[3].toLowerCase()
							}
						}
					);

				}, Object.create(null));

				resolve(spans);
			});

			this.send({
				Action: 'command',
				ActionID: actionId,
				command: 'gsm show spans'
			});
		})
	}


	/**
	 * Получить разверную информацию по GSM слоту
	 * @param {Object} arg
	 * @param {Number} arg.spanId - номер GSM слота
	 * @param {Number=} arg.actionId
	 * @return {Promise}
	 * */
	gsmShowSpan(arg) {
		return new Promise((resolve, reject) => {
			if (STATE_IS_AUTH !== this.state)
				return reject('!STATE_IS_AUTH');

			let actionId = arg.actionId || Math.random() + '';

			this.once('action-id-' + actionId, (data) => {
				resolve({ event: data.fields });
			});

			this.send({
				Action: 'command',
				ActionID: actionId,
				command: 'gsm show span ' + arg.spanId
			});
		});
	}


	/**
	 * Вернуть свободный слот
	 * @return {Promise}
	 * */
	getGsmReadySpan() {
		return this.gsmShowSpans().then(spans => {
			let spansIds = Object.keys(spans).sort(),
				promises = spansIds.reduceRight((prev, spanId) => {
					prev.push(
						this.gsmShowSpan({
							spanId: spanId
						}).then(span => {
							if ('READY' === span.State) {
								span.spanId = spanId;

								return Promise.resolve(span);
							}
						})
					);

					return prev;
				}, []);

			promises.push(
				new Promise((r, reject) => {
					setTimeout(() => reject('MPBX.getGsmReadySpan(): timeout'), 15 * 1000);
				})
			);

			return Promise.race(promises);
		});
	}


	isASCII(str, extended) {
		return (extended ? /^[\x00-\xFF]*$/ : /^[\x00-\x7F]*$/).test(str);
	}


	_processSMSMessage(msg) {
		let c,
		    tmp,
		    len,
		    size,
		    cSMSSize,
		    aMsg = [];

		msg = (msg || '') + '';

		msg = msg.trim();

		if (this.isASCII(msg)) {
			size = MSG_LEN_7_BIT;
			cSMSSize = MSG_LEN_7_BIT - 8;

		} else {
			size = MSG_LEN_8_BIT;
			cSMSSize = MSG_LEN_8_BIT - 3;
		}

		len = msg.length;

		if (len <= size) {
			aMsg.push(msg);

		} else {
			tmp = parseInt(len / cSMSSize);

			for (c = 0; c < tmp; c++)
				aMsg.push(msg.substr(c * cSMSSize, cSMSSize));

			tmp = len % cSMSSize;

			if (tmp) {
				msg = msg.substr(c * cSMSSize, tmp);

				aMsg.push(msg);
			}
		}

		return aMsg;
	}


	/**
	 * Отправить СМС
	 * @param {String | Array} arg.msg
	 * @param {String} arg.dest - номер получателя
	 * @param {String} arg.tel - номер получателя
	 * @param {String | Number} arg.spanId - номер GSM слота
	 * @return {Promise}
	 * */
	gsmSendSMS(arg = {}) {
		return Promise.race([
			new Promise((resolve, reject) => {
				if (STATE_IS_AUTH !== this.state)
					return reject('MBPX.gsmSendSMS(): !STATE_IS_AUTH');

				let actionId    = arg.actionId || Math.random() + '',
				    flag        = Math.random().toString().slice(-3),
				    tel         = arg.tel || arg.dest,
				    spanId      = arg.spanId,
				    msg         = this._processSMSMessage(arg.msg);

				if (!msg.length)
					return reject('!msg');

				this.once('action-id-' + actionId, data => {
					// TODO АТС не возвращает статус отправки - придумать как решить
					resolve({ event: data.fields });
				});

				if (msg.length < 2) {
					return this.send({
						action: 'command',
						actionId,
						command: `gsm send sms ${spanId} ${tel} "${msg[0]}"`
					});
				}

				return Promise.all(
					msg.map((_msg, idx) => {
						return this.send({
							action: 'command',
							actionId,
							command: `gsm send sync csms ${spanId} ${tel} "${_msg}" ${flag} ${msg.length} ${idx + 1} 20`
						});
					})
				);
			}),
			new Promise((r, reject) => {
				let { timeout = 15000 } = arg;

				setTimeout(() => reject('MPBX.gsmSendSMS(): timeout'), timeout);
			})
		]);
	}


	/**
	 * Произвести звонок через дозвон из АТС
	 * @param {Object} arg
	 * @param {String} arg.from
	 * @param {String} arg.to
	 * */
	dial(arg = {}) {
		let { from, to, timeout, actionId } = arg;

		timeout = timeout || 30000;
		actionId = actionId || Math.random() + '';

		return Promise.race([
			new Promise((resolve, reject) => {
				if (STATE_IS_AUTH !== this.state)
					return reject('EgPBX.dial(): !STATE_IS_AUTH');

				if (!from)
					return reject('arg.from supposed to be not empty string');

				if (!to)
					return reject('arg.to supposed to be not empty string');

				this.send({
					action: 'Originate',
					channel: 'SIP/' + from,
					context: 'DLPN_DialPlan' + from,
					exten: to,
					priority: '1',
					async: 'YES',
					timeout: timeout,
					callerid: to,
					actionId
				});

				this.once('action-id-' + actionId, data => {
					resolve({ event: data.fields });
				});
			}),
			new Promise((r, reject) => {
				let socTimeout = timeout + 3000;

				setTimeout(() => reject('EgPBX.dial(): timeout'), socTimeout);
			})
		]);
	}


	/**
	 * Перенаправить звонко с канала "А" на канал "Б"
	 * @param {Object} arg
	 * @param arg.fromChannel
	 * @param arg.toChannel
	 * */
	redirect(arg) {
		let { channel, toTel, timeout, actionId } = arg,

			context = 'DLPN_DialPlan' + toTel;

		timeout = timeout || 30000;
		actionId = actionId || Math.random() + '';

		return Promise.race([
			new Promise((resolve, reject) => {
				if (STATE_IS_AUTH !== this.state)
					return reject('EgPBX.redirect(): !STATE_IS_AUTH');

				if (!channel)
					return reject('arg.channel supposed to be not empty string');

				if (!toTel)
					return reject('arg.toTel supposed to be not empty string');

				this.once('action-id-' + actionId, data => {
					resolve({ event: data.fields });
				});

				this.send({
					action: 'Redirect',
					channel,
					exten: toTel,
					priority: '1',
					context,
					extraPriority: '1',
					actionId
				});
			}),
			new Promise((r, reject) => {
				let socTimeout = timeout + 3000;

				setTimeout(() => reject('EgPBX.redirect(): timeout'), socTimeout);
			})
		]);
	}

}

module.exports = PBX;