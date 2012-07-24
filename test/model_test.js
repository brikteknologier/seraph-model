var assert = require('assert');
var model = require('../');
var Emitter = require('events').EventEmitter;
var util = require('util');

function SeraphMock() {
  Emitter.call(this);
  var self = this;

  function mockMethod(methodName) {
    self[methodName] = function() {
      self.emit(methodName, [].slice.call(arguments));
    };
  }

  ['save', 'index', 'find'].forEach(mockMethod);
}
util.inherits(SeraphMock, Emitter);

describe('Seraph Model', function() {
  describe('validation', function() {
    it('should fail save call when validation fails', function(done) {
      var mockdb = new SeraphMock();
      var beer = model(mockdb, 'Beer');
      beer.validators.push(function(beer, callback) {
        callback(beer.age > 15 ? 'fail!' : null);
      });

      mockdb.on('save', function() {
        assert.fail('called save', 'should not call save');
        done();
      });

      var ipa = {type:'IPA', age:25};
      beer.save(ipa, function(err, ipa) {
        assert.ok(err);
        done();
      })
    });
  });
  describe('preparation', function() {
    it('should transform the object by calling preparers', function(done) {
      var numberThinger = model(null, 'NumberThinger');
      var numberThing = { number: 10 };
      numberThinger.preparers.push(function(numberThing, callback) {
        numberThing.number *= 15;
        callback(null, numberThing);
      });
      numberThinger.prepare(numberThing, function(err, thingedNumber) {
        assert.ok(!err);
        assert.notDeepEqual(numberThing, thingedNumber);
        assert.ok(thingedNumber.number === 10 * 15);
        done();
      });
    });
    it('should fail save call when a preparer fails', function(done) {
      var mockdb = new SeraphMock();
      var beer = model(mockdb, 'Beer');
      beer.preparers.push(function(beer, callback) {
        callback('fail!');
      });

      mockdb.on('save', function() {
        assert.fail('called save', 'should not call save');
        done();
      });

      var ipa = {type:'IPA', age:10};
      beer.save(ipa, function(err, ipa) {
        assert.ok(err);
        done();
      })
    });
  });
  describe('whitelisting/fields', function() {
    it('should whitelist a series of properties', function(done) {
      var beer = model(null, 'Beer');
      beer.fields = [ 'type', 'brewery', 'name' ];

      var ipa = {type:'IPA', brewery:'Lervig', name:'Rye IPA', country:'Norway'};
      beer.prepare(ipa, function(err, preparedIpa) {
        assert.ok(!err);
        assert.notDeepEqual(ipa, preparedIpa);
        assert.deepEqual(preparedIpa, {type:'IPA', brewery:'Lervig', name:'Rye IPA'});
        done();
      });
    });
    it('should not whitelist any fields by default', function(done) {
      var beer = model(null, 'Beer');
      var ipa = {type:'IPA', brewery:'Lervig', name:'Rye IPA', country:'Norway'};
      beer.prepare(ipa, function(err, preparedIpa) {
        assert.ok(!err);
        assert.deepEqual(ipa, preparedIpa);
        done();
      });
    });
  });
});