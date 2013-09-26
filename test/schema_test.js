var assert = require('assert');
var model = require('../');
var Emitter = require('events').EventEmitter;
var util = require('util');
var seraph = require('disposable-seraph');
var _ = require('underscore');

var parseSchema = require('../lib/schema');

describe.only('Seraph Schema', function() {
  var neo;
  var db;
  before(function(done) {
    seraph(function(err, _db, _neo) {
      if (err) return done(err);
      db = _db;
      neo = _neo;
      setTimeout(function() {
        db.index.create('nodes', done);
      }, 250);
    });
  });

  after(function(done) {
    neo.stop(function(err) {
      neo.clean(done);
    });
  });
  describe('validation: fail', function() {
    it('should fail save call when validation fails: required', function(done) {
      var beerSchema = {
        type: String,
        age: { type: Number, required: true }
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {type:'IPA'};
      beer.save(ipa, function(err, savedipa) {
        assert.ok(err);
        assert(!savedipa);
        assert(!ipa.id);
        done();
      });
    });
    it('should fail save call when validation fails: match', function(done) {
      var emailRegEx = /^(?:[\w\!\#\$\%\&\'\*\+\-\/\=\?\^\`\{\|\}\~]+\.)*[\w\!\#\$\%\&\'\*\+\-\/\=\?\^\`\{\|\}\~]+@(?:(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-](?!\.)){0,61}[a-zA-Z0-9]?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9\-](?!$)){0,61}[a-zA-Z0-9]?)|(?:\[(?:(?:[01]?\d{1,2}|2[0-4]\d|25[0-5])\.){3}(?:[01]?\d{1,2}|2[0-4]\d|25[0-5])\]))$/;
      var beerSchema = {
        email: {type: String, match: emailRegEx }
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {email: 'bad'};
      beer.save(ipa, function(err, savedipa) {
        assert.ok(err);
        assert(!savedipa);
        assert(!ipa.id);
        done();
      });
    });
    it('should fail save call when validation fails: enum', function(done) {
      var BEER_TYPE = ['stout', 'lager', 'ale', 'cider'];
      var beerSchema = {
        type: {type: String, enum: BEER_TYPE}
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {type:'IPA'};
      beer.save(ipa, function(err, savedipa) {
        assert.ok(err);
        assert(!savedipa);
        assert(!ipa.id);
        done();
      });
    });
    it('should fail save call when validation fails: min/max', function(done) {
      var beerSchema = {
        type: String,
        age: { type: Number, min: 16, max: 65 }
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {type:'IPA', age: 15};
      beer.save(ipa, function(err, savedipa) {
        assert.ok(err);
        assert(!savedipa);
        assert(!ipa.id);
        var other = {type:'other', age:70};
        beer.save(ipa, function(err, savedipa2) {
          assert.ok(err);
          assert(!savedipa2);
          assert(!other.id);
          done();
        });
      });
    });
    it('should fail save call when cast fails', function(done) {
      var beerSchema = {
        created: {type: Date}
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {created: 'blue'};
      beer.save(ipa, function(err, savedipa) {
        assert.ok(err);
        assert(!savedipa);
        assert(!ipa.id);
        done();
      });
    });
  });
  describe('validation: pass', function() {
    it('should pass save call when validation passes: required', function(done) {
      var beerSchema = {
        type: String,
        age: { type: Number, required: true }
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {type:'IPA', age: 12};
      beer.save(ipa, function(err, savedipa) {
        assert(!err);
        assert(savedipa);
        assert(savedipa.type === 'IPA');
        done();
      });
    });
    it('should pass save call when validation passes: match', function(done) {
      var emailRegEx = /^(?:[\w\!\#\$\%\&\'\*\+\-\/\=\?\^\`\{\|\}\~]+\.)*[\w\!\#\$\%\&\'\*\+\-\/\=\?\^\`\{\|\}\~]+@(?:(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-](?!\.)){0,61}[a-zA-Z0-9]?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9\-](?!$)){0,61}[a-zA-Z0-9]?)|(?:\[(?:(?:[01]?\d{1,2}|2[0-4]\d|25[0-5])\.){3}(?:[01]?\d{1,2}|2[0-4]\d|25[0-5])\]))$/;
      var beerSchema = {
        email: {type: String, match: emailRegEx }
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {email: 'good@test.com'};
      beer.save(ipa, function(err, savedipa) {
        assert(!err);
        assert(savedipa);
        assert(savedipa.email === 'good@test.com');
        done();
      });
    });
    it('should pass save call when validation passes: enum', function(done) {
      var BEER_TYPE = ['stout', 'lager', 'ale', 'cider'];
      var beerSchema = {
        type: {type: String, enum: BEER_TYPE}
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {type:'stout'};
      beer.save(ipa, function(err, savedipa) {
        assert(!err);
        assert(savedipa);
        assert(savedipa.type === 'stout');
        done();
      });
    });
    it('should pass save call when validation passes: min/max', function(done) {
      var beerSchema = {
        type: String,
        age: { type: Number, min: 16, max: 65 }
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {type:'IPA', age: 25};
      beer.save(ipa, function(err, savedipa) {
        assert(!err);
        assert(savedipa);
        assert(savedipa.age === 25);
        done();
      });
    });
    it('should pass save call when cast passes', function(done) {
      var beerSchema = {
        created: {type: Date}
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {created: new Date()};
      beer.save(ipa, function(err, savedipa) {
        assert(!err);
        assert(savedipa);
        assert(new Date(savedipa.created));
        done();
      });
    });
  });
  describe("preparations", function(){
    it('should trim a string', function(done) {
      var beerSchema = {
        type: {type: String, trim:true }
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {type:'IPA   '};
      beer.save(ipa, function(err, savedipa) {
        assert(!err);
        assert(savedipa);
        assert(savedipa.type === 'IPA');
        done();
      });
    });
    it('should lowercase a string', function(done) {
      var beerSchema = {
        type: {type: String, lowercase: true}
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {type:'IPA', age:25};
      beer.save(ipa, function(err, savedipa) {
        assert(!err);
        assert(savedipa);
        assert(savedipa.type === 'ipa');
        done();
      });
    });
    it('should uppercase a string', function(done) {
      var beerSchema = {
        type: {type: String, uppercase: true}
      };
      var beer = model(db, 'Beer');
      parseSchema(beerSchema, beer);

      var ipa = {type:'ipa', age:25};
      beer.save(ipa, function(err, savedipa) {
        assert(!err);
        assert(savedipa);
        assert(savedipa.type === 'IPA');
        done();
      });
    });
  });
  describe('indexing', function() {
    it ('should index a new object', function(done) {
      var beer = model(db, 'Beer');

      var ipa = {type: 'IPA', age: 25};

      beer.save(ipa, function(err, ipa) {
        assert(!err);
        db.index.read('nodes', 'type', 'Beer', function(err, nodes) {
          assert(!err);
          assert(nodes);
          if (!Array.isArray(nodes)) nodes = [nodes];

          assert(!!_.find(nodes, function(node) {
            return node.id == ipa.id;
          }));

          db.index.read('nodes', 'Beer', ipa.id, function(err, node) {
            assert(!err);
            assert(!!node);
            assert.deepEqual(node, ipa);
            done();
          });
        });
      });
    });
    it ('should not index an old object', function(done) {
      var beer = model(db, 'Beer');

      var ipa = {type: 'IPA', age: 25};
      beer.save(ipa, function(err, ipa) {
        assert(!err);
        db.index.remove('nodes', ipa.id, 'Beer', ipa.id, function(err) {
          assert(!err, err);
          beer.save(ipa, function(err) {
            assert(!err);
            db.index.read('nodes', 'Beer', ipa.id, function(err, node) {
              assert(!err);
              assert(!node);
              done();
            });
          });
        });
      });
    });
    it ('should not throw an error if the nodes index doesn\'t exist', function(done) {
      var beer = model(db, 'Beer');
      var hop = model(db, 'Hop');
      beer.compose(hop, 'hops', 'hoppedby');

      beer.save({name:'Vildhjarta', hops:{name:'Centennial'}},function(e,b) {
        db.node.index.delete('nodes', function(err) {
          assert(!err);

          beer.read(b, function(err, ipa) {
            assert(!err);
            done()
          });
        });
      });
    });
    it ('should manually index an object', function(done) {
      var beer = model(db, 'Beer');

      var ipa = {type: 'IPA', age: 25};

      db.save(ipa, function(err, ipa) {
        assert(!err);
        beer.index(ipa, function(err, ipa) {
          assert(!err);
          db.index.read('nodes', 'Beer', ipa.id, function(err, node) {
            assert(!err);
            assert(!!node);
            assert.deepEqual(node,ipa);
            done();
          });
        });
      });
    });
    it ('should add to more than one index', function(done) {
      var beer = model(db, 'Beer');

      beer.addIndex('otherIndex', 'something', 'stuff');

      var ipa = {type: 'IPA', age: 25};

      beer.save(ipa, function(err, ipa) {
        assert(!err);
        db.index.read('otherIndex', 'something', 'stuff', function(err,nodes) {
          assert(!err);
          assert(nodes);
          if (!Array.isArray(nodes)) nodes = [nodes];
          assert(!!_.find(nodes, function(node) {
            return node.id == ipa.id;
          }));
          done();
        });
      });
    });
    it('changing the name after construction should not break indexes', function(done) {
      var beer = model(db);

      beer.type = 'Beer';

      beer.save({name:'Mega Amazing Ale'}, function(err, ale) {
        assert(!err);
        assert(ale.name == 'Mega Amazing Ale');
        db.index.read('nodes', 'Beer', ale.id, function(err, indexedAle) {
          assert(!err);
          assert.deepEqual(indexedAle, ale);
          done();
        });
      });
    });
    it('adding an index before changing name should not be destructive', function(done) {
      var beer = model(db);

      beer.addIndex('mega_index', 'omg', function(beer, cb) {
        cb(null, beer.id);
      });
      beer.type = 'Beer';

      beer.save({name:'Mega Amazing Ale'}, function(err, ale) {
        assert(!err);
        assert(ale.name == 'Mega Amazing Ale');
        db.index.read('mega_index', 'omg', ale.id, function(err, indexedAle) {
          assert(!err);
          assert.deepEqual(indexedAle, ale);
          done();
        });
      });
    });
  });
});
