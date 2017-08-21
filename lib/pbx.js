'use strict';

const
	STATE_NONE = 0,
	STATE_IS_AUTH = 1,

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

		this.debug && console.log('---package:start---\r\n', str, '---package:end---\r\n');

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

		this.debug && console.log('---e:data:start---\r\n', msg, '---e:data:end---\r\n');

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

				this._soc.write(
					'action: login\r\n' +
					'username: ' + arg.usr + '\r\n' +
					'secret: ' + arg.pwd + '\r\n\r\n'
				);
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

			let socMsg = '' +
				'Action: command\r\n' +
				'ActionID: ' + actionId + '\r\n' +
				'command: gsm show spans\r\n\r\n';

			this._soc.write(socMsg);
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

			let socMsg = '' +
				'Action: command\r\n' +
				'ActionID: ' + actionId + '\r\n' +
				'command: gsm show span ' + arg.spanId +
				'\r\n\r\n';

			this.once('action-id-' + actionId, (data) => {
				resolve(data.fields);
			});

			this._soc.write(socMsg);
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

				let actionId = arg.actionId || Math.random() + '',
					tel = arg.tel || arg.dest,
					spanId = arg.spanId,
					msg = arg.msg.trim();

				if (!msg)
					return reject('!msg');

				let socMsg = ''
					+          'Action: command'
					+ '\r\n' + 'ActionID: ' + actionId
					+ '\r\n' + `command: gsm send sms ${spanId} ${tel} "${arg.msg}"`
					+ '\r\n'
					+ '\r\n';

				this.once('action-id-' + actionId, () => {
					// TODO АТС не возвращает статус отправки - придумать как решить
					resolve();
				});

				this._soc.write(socMsg);
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

				let socMsg = ''
					+          'Action: Originate'
					+ '\r\n' + 'Channel: SIP/' + from
					+ '\r\n' + 'Context: DLPN_DialPlan' + from
					+ '\r\n' + 'Exten: ' + to
					+ '\r\n' + 'Priority: 1'
					+ '\r\n' + 'Async: YES'
					+ '\r\n' + 'Timeout: ' + timeout
					+ '\r\n' + 'Callerid: ' + to
					+ '\r\n' + 'ActionID: ' + actionId
					+ '\r\n'
					+ '\r\n';

				this.once('action-id-' + actionId, () => resolve());

				this._soc.write(socMsg);
			}),
			new Promise((r, reject) => {
				let socTimeout = timeout + 3000;

				setTimeout(() => reject('EgPBX.dial(): timeout'), socTimeout);
			})
		]);
	}

}

module.exports = PBX;