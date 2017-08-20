const
	assert = require('assert');

describe('m-pbx', () => {
	let PBX = require('./pbx.js');

	function mkPBX() {
		let pbx = new PBX();
		pbx.debug = 1;

		return pbx.connect({
			port: '5038',
			host: '192.168.3.13'
		}).login({
			usr: 'admin',
			pwd: 'admin'
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
				port: '5038',
				host: '192.168.3.13'
			}).login({
				usr: 'admin',
				pwd: 'admin'
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