var assert = require('assert');
var model = require('../');
var Emitter = require('events').EventEmitter;
var util = require('util');
var seraph = require('disposable-seraph');
var _ = require('underscore');

describe('Seraph Model', function() {
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
  describe('validation', function() {
    it('should fail save call when validation fails', function(done) {
      var beer = model(db, 'Beer');
      beer.on('validate', function(beer, callback) {
        callback(beer.age > 15 ? 'fail!' : null);
      });

      var ipa = {type:'IPA', age:25};
      beer.save(ipa, function(err, savedipa) {
        assert.ok(err);
        assert(!savedipa);
        assert(!ipa.id);
        done();
      })
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
    it('changing the name after construction should not break indexes', 
    function(done) {
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
    it('adding an index before changing name should not be destructive', 
    function(done) {
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
  describe('save events', function() {
    it('should fire the beforeSave event', function(done) {
      var beer = model(db, 'Beer');

      var evfired = false;
      beer.on('beforeSave', function() {
        evfired = true;
      });

      beer.save({type:'IPA'}, function(err,obj) {
        assert(evfired);
        assert(!err);
        done();
      });
    });
    it('should fire the afterSave event', function(done) {
      var beer = model(db, 'Beer');

      var evfired = false;
      beer.on('afterSave', function() {
        evfired = true;
      });

      beer.save({type:'IPA'}, function(err,obj) {
        assert(evfired);
        assert(!err);
        done();
      });
    });
    it('should fire the beforeSave event after prep & val', function(done) {
      var beer = model(db, 'Beer');

      var evfired = false;
      var validated = false;
      var prepared = false;
      beer.on('beforeSave', function() {
        evfired = validated && prepared;
      });

      beer.on('validate', function(obj,cb) { validated = true, cb(); });
      beer.on('prepare', function(obj,cb) { prepared = true, cb(null, obj) });

      beer.save({type:'IPA'}, function(err,obj) {
        assert(evfired);
        assert(!err);
        done();
      });
    });
    it('should fire the afterSever event after indexing', function(done) {
      var beer = model(db, 'Beer');

      var evfired = false;
      var indexed = false;
      beer.on('afterSave', function() {
        evfired = indexed;
      });

      beer.addIndex('testthingy', 'stuff', function(obj,cb) { 
        indexed = true, cb(null, 'thing');
      });

      beer.save({type:'IPA'}, function(err,obj) {
        assert(evfired);
        assert(!err);
        done();
      });
    });
  });
  describe('preparation', function() {
    it('should transform the object by calling preparers', function(done) {
      var numberThinger = model(null, 'NumberThinger');
      var numberThing = { number: 10 };
      numberThinger.on('prepare', function(numberThing, callback) {
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
      var beer = model(db, 'Beer');
      beer.on('prepare', function(beer, callback) {
        callback('fail!');
      });

      var ipa = {type:'IPA', age:10};
      beer.save(ipa, function(err, sipa) {
        assert.ok(err);
        assert(!sipa);
        assert(!ipa.id);
        done();
      })
    });
  });
  describe('whitelisting/fields', function() {
    it('should whitelist a series of properties', function(done) {
      var beer = model(db, 'Beer');
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
      var beer = model(db, 'Beer');
      var ipa = {type:'IPA', brewery:'Lervig', name:'Rye IPA', country:'Norway'};
      beer.prepare(ipa, function(err, preparedIpa) {
        assert.ok(!err);
        assert.deepEqual(ipa, preparedIpa);
        done();
      });
    });
    it('should not remove composed fields', function(done) {
      var beer = model(db, 'Beer');
      var hop = model(db, 'Hop');
      beer.fields = [ 'type', 'brewery', 'name' ];
      beer.compose(hop, 'hops');
      beer.prepare({name:'Fjellblek', hops:[{name:'El Dorado'}]}, function(e, o) {
        assert(!e);
        assert(o.hops[0].name == 'El Dorado');
        done();
      });
    });
    it('should not introduce a whitelist on composing if there wasnt one',
    function(done) {
      var beer = model(db, 'Beer');
      var hop = model(db, 'Hop');
      beer.compose(hop, 'hops');
      assert(beer.fields.length == 0);
      beer.fields = ['potato', 'hair'];
      assert(beer.fields.length == 2);
      done();
    });
    it('should not matter which order comps and fields were added', 
    function(done) {
      var beer = model(db, 'Beer');
      var hop = model(db, 'Hop');
      beer.compose(hop, 'hops');
      beer.fields = [ 'type', 'brewery', 'name' ];
      beer.prepare({name:'Fjellblek', hops:[{name:'El Dorado'}]}, function(e, o) {
        assert(!e);
        assert(o.hops[0].name == 'El Dorado');
        done();
      });
    });
  });
  it('it should read a model from the db', function(done) {
    var beer = model(db, 'Beer');
    beer.save({name:"120m IPA"}, function(err, dfh) {
      assert(!err,err);
      beer.read(dfh.id, function(err, thebeer) {
        assert(!err);
        assert(thebeer.name == "120m IPA");
        done();
      });
    });
  });
  it('reading should only read the relevant model', function(done) {
    var beer = model(db, 'Beer');
    var food = model(db, 'Food');
  
    beer.save({name:"Heady Topper"}, function(err, heady) {
      assert(!err);
      food.save({name:"Pinnekjøtt"}, function(err, meat) {
        assert(!err);
        beer.read(meat.id, function(err, nothing) {
          assert(!nothing);
          food.read(beer.id, function(err, nothing) {
            assert(!nothing);
            done();
          });
        });
      })
    });
    
  });
  it('should save a model with a string id', function(done) {
    var beer = model(db, 'Beer');
    var food = model(db, 'Food');
    beer.compose(food, 'food')
  
    beer.save({name:"Heady Topper"}, function(err, heady) {
      assert(!err);
      heady.ponies = 10;
      heady.id = heady.id + '';
      beer.save(heady, function(err, heady) {
        assert(!err)
        assert(heady.ponies == 10);
        done();
      });
    });
  });
  it('it should check if a model exists', function(done) {
    var beer = model(db, 'Beer');
    beer.save({name:"120m IPA"}, function(err, dfh) {
      assert(!err);
      beer.exists(dfh.id, function(err, exists) {
        assert(!err);
        assert(exists);
        done();
      });
    });
  });
  it('exists should only return true for the relevant model', 
  function(done) {
    var beer = model(db, 'Beer');
    var food = model(db, 'Food');
  
    beer.save({name:"Heady Topper"}, function(err, heady) {
      assert(!err);
      food.save({name:"Pinnekjøtt"}, function(err, meat) {
        assert(!err);
        beer.exists(meat.id, function(err, exists) {
          assert(!exists);
          food.read(beer.id, function(err, exists) {
            assert(!exists);
            done();
          });
        });
      })
    });
    
  });
  describe('Composition', function() {
    it('it should allow composing of models and save them properly', 
    function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err,err);
        assert(meal.id)
        assert(meal.matchingBeers[0].id);
        assert(meal.matchingBeers[1].id);
        db.relationships(meal, function(err, rels) {
          assert(!err);
          assert(rels.length == 2);
          done();
        });
      });
      
    });
    it('it should allow more than one level of nested composition', 
    function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      var hop = model(db, 'Hop');
      food.compose(beer, 'matchingBeers', 'matches');
      beer.compose(hop, 'hops', 'contains_hop');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper", hops: {name: 'CTZ'}},
        {name:"Hovistuten", hops: [{name: 'Galaxy'},{name: 'Simcoe'}]}
      ]}, function(err, meal) {
        assert(!err);
        assert(meal.id)
        assert(meal.matchingBeers[0].id);
        assert(meal.matchingBeers[1].id);
        assert(meal.matchingBeers[0].hops.id)
        assert(meal.matchingBeers[1].hops[0].id);
        assert(meal.matchingBeers[1].hops[1].id);
        db.relationships(meal, function(err, rels) {
          assert(!err);
          assert(rels.length == 2);
          db.relationships(meal.matchingBeers[1], 'out', function(err, rels) {
            assert(!err)
            assert(rels.length == 2);
            done();
          });
        });
      });
      
    });
    it('it should fire the before and after save events for composed models', 
    function(done) {
      var beforeBeerSaveCount = 0,
          afterBeerSaveCount = 0,
          beforeFoodSaveCount = 0,
          afterFoodSaveCount = 0;

      var beer = model(db, 'Beer');
      var food = model(db, 'Food');

      beer.on('beforeSave', function() { ++beforeBeerSaveCount });
      beer.on('afterSave', function() { ++afterBeerSaveCount });
      food.on('beforeSave', function() { ++beforeFoodSaveCount });
      food.on('afterSave', function() { ++afterFoodSaveCount });

      food.compose(beer, 'matchingBeers', 'matches');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err);
        assert(beforeBeerSaveCount == 2);
        assert(afterBeerSaveCount == 2);
        assert(beforeFoodSaveCount == 1);
        assert(afterFoodSaveCount == 1);
        done();
      });
      
    });
    it('should handle presave async transforms', 
    function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      
      beer.on('prepare', function(obj, cb) {
        setTimeout(function() {
          obj.thingy = "prepared";
          cb(null, obj);
        }, 20);
      });

      food.on('prepare', function(obj, cb) {
        setTimeout(function() {
          obj.otherthing = "prepared?";
          cb(null, obj);
        }, 20);
      });

      food.compose(beer, 'matchingBeers', 'matches');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err);
        assert(meal.otherthing == 'prepared?');
        assert(meal.matchingBeers[0].thingy == 'prepared');
        assert(meal.matchingBeers[1].thingy == 'prepared');
        done();
      });
      
    });

    it('should properly index models', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');

      food.compose(beer, 'matchingBeers', 'matches');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        db.index.read('nodes', 'Beer', meal.matchingBeers[0].id, 
        function(err, node) {
          assert(!err, err);
          assert(node);
          assert(node.id == meal.matchingBeers[0].id);
          db.index.read('nodes', 'Food', meal.id, function(err, node) {
            assert(node);
            assert(node.id == meal.id);
            done();
          });
        });
      });
    });

    it('should implicitly read compositions when reading', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');

      food.compose(beer, 'matchingBeers', 'matches');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err);
        food.read(meal, function(err, readMeal) {
          assert(!err,err);
          assert.deepEqual(meal, readMeal);
          done();
        });
      });
    });

    it('should read recursive compositions', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      var hop = model(db, 'Hop');
      var aa = model(db, 'AlphaAcid');
      food.compose(beer, 'matchingBeers', 'matches');
      beer.compose(hop, 'hops', 'contains_hop');
      hop.compose(hop, 'aa', 'has_aa');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper", hops: {name: 'CTZ',aa:{percent:'15%'}}},
        {name:"Hovistuten", hops: [{name: 'Galaxy'},{name: 'Simcoe'}]}
      ]}, function(err, meal) {
        assert(!err);
        food.read(meal, function(err, readMeal) {
          assert(!err,err);
          assert.deepEqual(meal, readMeal);
          done();
        });
      });
    });

    it('should read a single composited property', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      var hop = model(db, 'Hop');
      var aa = model(db, 'AlphaAcid');
      food.compose(beer, 'matchingBeers', 'matches');
      beer.compose(hop, 'hops', 'contains_hop');
      hop.compose(hop, 'aa', 'has_aa');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper", hops: {name: 'CTZ',aa:{percent:'15%'}}},
        {name:"Hovistuten", hops: [{name: 'Galaxy'},{name: 'Simcoe'}]}
      ]}, function(err, meal) {
        assert(!err);
        food.readComposition(meal, 'matchingBeers', function(err, hops) {
          assert(!err,err);
          assert.deepEqual(hops, meal.matchingBeers);
          done();
        });
      });
    });

    it('should update a composition', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      var hop = model(db, 'Hop');
      var aa = model(db, 'AlphaAcid');
      food.compose(beer, 'matchingBeers', 'matches');
      beer.compose(hop, 'hops', 'contains_hop');
      hop.compose(hop, 'aa', 'has_aa');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper", hops: {name: 'CTZ',aa:{percent:'15%'}}},
        {name:"Hovistuten", hops: [{name: 'Galaxy'},{name: 'Simcoe'}]}
      ]}, function(err, meal) {
        assert(!err);
        meal.matchingBeers = {name:"Blekfjellet", hops:
          {name: 'El Dorado',aa:{percent:'10%'}}};
        food.save(meal, function(err, meal) {
          assert(!err);
          food.read(meal, function(err, meal) {
            assert(meal.name == 'Pinnekjøtt');
            assert(meal.matchingBeers.name == 'Blekfjellet');
            assert(meal.matchingBeers.hops.name == 'El Dorado');
            assert(meal.matchingBeers.hops.aa.percent == '10%');
            done();
          });
        });
      });
    });

    it('should support partial composition updates', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      var hop = model(db, 'Hop');
      var aa = model(db, 'AlphaAcid');
      food.compose(beer, 'matchingBeers', 'matches');
      beer.compose(hop, 'hops', 'contains_hop');
      hop.compose(hop, 'aa', 'has_aa');
    
      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper", hops: {name: 'CTZ',aa:{percent:'15%'}}},
        {name:"Hovistuten", hops: [{name: 'Galaxy'},{name: 'Simcoe'}]}
      ]}, function(err, meal) {
        assert(!err);
        meal.matchingBeers.push({ name: "Imperialfjellet" });
        food.save(meal, function(err, meal) {
          assert(!err);
          food.read(meal, function(err, meal) {
            assert(meal.name == 'Pinnekjøtt');
            assert(meal.matchingBeers.length == 3);
            assert(meal.matchingBeers[2].name == 'Imperialfjellet');
            done();
          });
        });
      });
    });

    it('should support partial composition collection pushes', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');
    
      food.save(
        {name:"Pinnekjøtt", matchingBeers: {name:"Heady Topper"} }, 
        function(err, meal) {
          assert(!err);
          meal.matchingBeers = [meal.matchingBeers,{ name: "Imperialfjellet" }]
          food.save(meal, function(err, meal) {
            assert(!err);
            food.read(meal, function(err, meal) {
              assert(!err)
              assert(meal.name == 'Pinnekjøtt');
              assert(meal.matchingBeers.length == 2);
              assert(meal.matchingBeers[0].name == 'Heady Topper');
              assert(meal.matchingBeers[1].name == 'Imperialfjellet');
              done();
            });
          });
        });
    });

    it('should not convert a single-el array to an object', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches', true);
    
      food.save(
        {name:"Pinnekjøtt", matchingBeers: [{name:"Heady Topper"}] }, 
        function(err, meal) {
          assert(!err);
          assert(Array.isArray(meal.matchingBeers));
          assert(meal.matchingBeers[0].name == "Heady Topper");
          food.read(meal, function(err, otherMeal) {
            assert(Array.isArray(otherMeal.matchingBeers));
            assert(otherMeal.matchingBeers[0].name == "Heady Topper");
            done()
          })
        });
    });

    it('should give a usable reply when asked for nonexistent data', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');

      food.read({id: 5318008}, function(err, fud) {
        assert(!err);
        assert.strictEqual(fud, false);
        done();
      });
    });
  });

  describe('uniqueness', function() {
    it('should be able to set a unique key', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.setUniqueKey('name', false);
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        assert(ale.id);
        assert.equal(ale.name, 'Pacific Ale');
        beer.save({name: 'Pacific Ale'}, function(err, ale) {
          assert(!ale);
          assert(err);
          assert.equal(err.statusCode, 409);
          done();
        });
      });
    });

    it('should be able to set a unique index', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      var uniqueId = Date.now()
      beer.setUniqueIndex('uniqueything', 'beer', 
        function(obj, cb) { cb(null, uniqueId) }, false);
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        assert(ale.id);
        assert.equal(ale.name, 'Pacific Ale');
        beer.save({name: 'Pacific Ale'}, function(err, ale) {
          assert(!ale);
          assert(err);
          assert.equal(err.statusCode, 409);
          done();
        });
      });
    });

    it('should be able to set a unique key and use return-old mode', 
    function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.setUniqueKey('name', true);
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        assert(ale.id);
        assert.equal(ale.name, 'Pacific Ale');
        beer.save({name: 'Pacific Ale', otherThing: 1}, function(err, ale2) {
          assert(!err);
          assert.deepEqual(ale, ale2);
          assert.ok(!ale2.otherThing);
          beer.read(ale.id, function(err, ale3) {
            assert(!err);
            assert(!ale3.otherThing);
            assert.deepEqual(ale, ale3);
            done();
          });
        });
      });
    });

    it('should enforce uniqueness on composed models', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.setUniqueKey('name', false);
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');
      food.save({name: 'Burrito', matchingBeers: {name: 'Pacific Ale'}}, 
      function(err, meal) {
        assert(!err);
        assert(meal.id);
        assert.equal(meal.name, 'Burrito');
        meal.matchingBeers = {name: 'Pacific Ale'};
        food.save(meal, function(err, meal) {
          assert(!meal);
          assert(err);
          // pending neo4j issue #906
          //assert.equal(err.statusCode, 409);
          done();
        });
      });
    });

    it('should support updating', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.setUniqueKey('name');
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        assert(ale.id);
        assert.equal(ale.name, 'Pacific Ale');
        ale.otherThing = 1;
        beer.save(ale, function(err, ale2) {
          assert(!err);
          assert.deepEqual(ale, ale2);
          assert.ok(ale2.otherThing);
          beer.read(ale.id, function(err, ale3) {
            assert(!err);
            assert(ale3.otherThing);
            assert.deepEqual(ale, ale3);
            done();
          });
        });
      });
    });
  });
});
