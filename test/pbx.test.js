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

				return pbx.gsmShowSpan({ spanId: 1 });

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

});