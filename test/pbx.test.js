const
	appCfg = require('./app-config.js'),
	pbxCfg = appCfg.external_services.pbx,
	assert = require('assert');

describe('m-pbx', () => {
	let PBX = require('./../lib/pbx.js');

	function mkPBX() {
		let pbx = new PBX();
		pbx.debug = 1;

		return pbx.connect({
			port: pbxCfg.port,
			host: pbxCfg.host
		}).login({
			usr: pbxCfg.usr,
			pwd: pbxCfg.pwd
		}).then(() => {
			return Promise.resolve(pbx);
		});
	}

	describe('.login()', () => {
		let hasLogin = 0;

		before((done) => {
			let pbx = new PBX();

			pbx.debug = 1;

			pbx.connect({
				port: pbxCfg.port,
				host: pbxCfg.host
			}).login({
				usr: pbxCfg.usr,
				pwd: pbxCfg.pwd
			}).then(() => {
				hasLogin = 1;

				done();

			}).catch(err => {
				done(err);
			})
		});

		it('', () => {
			assert.ok(hasLogin);
		});
	});


	describe('.gsmShowSpans', () => {
		let pbx,
			spans;

		before(done => {
			mkPBX().then(_pbx => {
				pbx = _pbx;

				return pbx.gsmShowSpans();

			}).then(_spans => {
				spans = _spans;

				pbx.disconnect();

				done();

			}).catch(
				err => done(err)
			);
		});

		it('', () => {
			Object.keys(spans).forEach((k) => {
				assert.equal(typeof spans[k], 'object');
			});
			assert.equal(Object.keys(spans).length, 4);
		});
	});


	describe('gsmShowSpan', () => {
		let pbx,
			span;

		before(done => {
			mkPBX().then(_pbx => {
				pbx = _pbx;

				return pbx.gsmShowSpan({ spanId: pbxCfg.span_id });

			}).then(_span => {
				span = _span;

				pbx.disconnect();

				done();
			})
			.catch(err => done(err));
		});

		it('', () => {
			assert.equal(typeof span, 'object');
		});
	});


	describe.skip('gsmSendSMS', function() {
		let pbx;

		this.timeout(10000);

		it('', function() {
			return mkPBX().then(_pbx => {
				pbx = _pbx;

				// длинное сообщение с кириллицей
				let msg = ''
					+ '1234567890'
					+ 'qwertyuiopasdfghjklzxcvbnm'
					+ 'QWERTYUIOPASDFGHJKLZXCVBNM'
					+ 'йцукенгшщзфывапролдячсмить'
					+ 'ЙЦУКЕНГШЩЗФЫВАПРОЛДЯЧСМИТЬ'
					+ '';

				return pbx.gsmSendSMS({
					spanId: pbxCfg.span_id,
					tel: '89787342741',
					msg: msg,
				});

			}).then(() => {
				console.log('done');

				pbx.disconnect();

			}).catch(err => {
				pbx.disconnect();

				return err;
			});
		});
	});

});