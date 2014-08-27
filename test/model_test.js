var assert = require('assert');
var model = require('../');
var async = require('async');
var Emitter = require('events').EventEmitter;
var util = require('util');
var seraph = require('disposable-seraph');
var _ = require('underscore');

describe('Seraph Model', function() {
  var neo;
  var db;
  before(function(done) {
    seraph({ version: "2.1.2" }, function(err, _db, _neo) {
      if (err) return done(err);
      db = _db;
      neo = _neo;
      done()
    });
  });

  after(function(done) {
    neo.stop(done);
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
    it('should not introduce a whitelist on composing if there wasnt one', function(done) {
      var beer = model(db, 'Beer');
      var hop = model(db, 'Hop');
      beer.compose(hop, 'hops');
      assert(beer.fields.length == 0);
      beer.fields = ['potato', 'hair'];
      assert(beer.fields.length == 2);
      done();
    });
    it('should not matter which order comps and fields were added', function(done) {
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
          food.read(heady.id, function(err, nothing) {
            assert(!nothing);
            done();
          });
        });
      })
    });

  });

  it('querying should only read the relevant model', function(done) {
    var beer = model(db, 'Beer');
    var food = model(db, 'Food');

    beer.save({name:"Heady Topper"}, function(err, heady) {
      assert(!err);
      food.save({name:"Pinnekjøtt"}, function(err, meat) {
        assert(!err);
        beer.query("start node=node({id})", { id: meat.id }, function(err, results) {
          assert(!err);
          assert(Array.isArray(results));
          assert(results.length == 0);
          done();
        });
      })
    });

  });

  it('querying should allow other variables and preserve them', function(done) {
    var beer = model(db, 'Beer');

    beer.save({name:"Heady Topper"}, function(err, heady) {
      assert(!err);
      beer.save({name:"Galaxy IPA"}, function(err, galaxy) {
        assert(!err);
        beer.query("match (beer:Beer) where id(beer) in {ids} with beer, {test: true} as stuff",
          { ids: [heady.id, galaxy.id] }, {varName: 'beer', otherVars: ['stuff']},
          function(err, results) {
          assert(!err);
          assert(results.length == 2);
          assert(results[0].stuff.test == true);
          assert(results[1].stuff.test == true);
          done();
        });
      })
    });
  });

  it('querying should allow manual filters', function(done) {
    var beer = model(db, 'Beer' + Date.now());

    async.forEach(_.range(0,25), function(num, callback) {
      beer.save({name:'amazing duplicate beer',sn:Math.ceil(Math.random() * 100000)}, callback);
    }, function(err) {
      beer.query("match (beer:" + beer.type + ")",{}, {
        varName: "beer",
        skip: 5,
        limit: 15,
        orderBy: 'beer.sn DESC'
      }, function(err, nodes) {
        assert(!err);
        assert(nodes.length == 15);
        for (var i = 0; i + 1 < nodes.length; ++i) {
          assert(nodes[i].sn > nodes[i + 1].sn);
        }
        done();
      });
    });
  });

  it('should allow "where" queries with options', function(done) {
    var beer = model(db, 'Beer' + Date.now());

    async.forEach(_.range(0,25), function(num, callback) {
      beer.save({name:'amazing duplicate beer',sn:Math.ceil(Math.random() * 100000)}, callback);
    }, function(err) {
      beer.where({ name: 'amazing duplicate beer' }, {
        varName: "beer",
        skip: 5,
        limit: 15,
        orderBy: 'beer.sn DESC'
      }, function(err, nodes) {
        assert(!err);
        assert(nodes.length == 15);
        for (var i = 0; i + 1 < nodes.length; ++i) {
          assert(nodes[i].sn > nodes[i + 1].sn);
        }
        done();
      });
    });
  });

  it('should allow "where" queries with regexp fields', function(done) {
    var beer = model(db, 'Beer' + Date.now());
    beer.save({name:'Tasty Beer'}, function(err, beer1) {
      assert(!err);
      beer.save({name:'TaStY bEeR'}, function(err, beer1) {
        assert(!err);
        beer.where({ name: new RegExp('TASTY BEER', 'i') }, {
          varName: "beer",
          skip: 0,
          limit: 15,
          orderBy: 'beer.sn DESC'
        }, function(err, nodes) {
          assert(!err);
          assert(nodes.length == 2);

          done();
        });
      });
    });
  });

  it('should allow "findAll" queries with options', function(done) {
    var beer = model(db, 'Beer' + Date.now());

    async.forEach(_.range(0,25), function(num, callback) {
      beer.save({name:'amazing duplicate beer',sn:Math.ceil(Math.random() * 100000)}, callback);
    }, function(err) {
      beer.findAll({
        varName: "beer",
        skip: 5,
        limit: 15,
        orderBy: 'beer.sn DESC'
      }, function(err, nodes) {
        assert(!err);
        assert(nodes.length == 15);
        for (var i = 0; i + 1 < nodes.length; ++i) {
          assert(nodes[i].sn > nodes[i + 1].sn);
        }
        done();
      });
    });
  });

  it('should fetch out another model that is related', function(done) {
    var beer = model(db, 'Beer' + Date.now());
    var hop = model(db, 'Hop' + Date.now());

    beer.save({ name: 'beer 1' }, function(err, beer1) {
      assert(!err);
      beer.save({ name: 'beer 2' }, function(err, beer2) {
        assert(!err);
        hop.save({ name: 'centennial' }, function(err, hop1) {
          assert(!err);
          db.relate([beer1, beer2], 'hopped_with', hop1, function(err, rel) {
            assert(!err);
            beer.findAll({
              include: {hop: { model: hop, rel: 'hopped_with', direction: 'out' }}
            }, function(err, nodes) {
              assert(!err);
              assert(nodes.length == 2);
              assert(nodes[0].hop.name == 'centennial');
              assert(nodes[1].hop.name == 'centennial');
              assert(nodes[0].name == 'beer 1' || nodes[0].name == 'beer 2');
              assert(nodes[1].name == 'beer 1' || nodes[1].name == 'beer 2');

              done();
            });
          });
        });
      });
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
  it('exists should only return true for the relevant model', function(done) {
    var beer = model(db, 'Beer');
    var food = model(db, 'Food');

    beer.save({name:"Heady Topper"}, function(err, heady) {
      assert(!err);
      food.save({name:"Pinnekjøtt"}, function(err, meat) {
        assert(!err);
        beer.exists(meat.id, function(err, exists) {
          assert(!exists);
          food.read(heady.id, function(err, exists) {
            assert(!exists);
            done();
          });
        });
      })
    });

  });

  describe('sm#Composition', function() {
    it('it should allow composing of models and save them properly', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err,err);
        assert(meal.id != null)
        assert(meal.matchingBeers[0].id);
        assert(meal.matchingBeers[1].id);
        db.relationships(meal, function(err, rels) {
          assert(!err);
          assert(rels.length == 2);
          done();
        });
      });

    });
    it('it should allow transient composition', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'drink', 'goes_with', {
        transient: true
      });

      food.save({name:'Pinnekjøtt'}, function(err, pinnekjøtt) {
        assert(!err);
        beer.save({name: 'Humlekanon'}, function(err, hk) {
          assert(!err);
          db.relate(pinnekjøtt, 'goes_with', hk, function(err) {
            assert(!err);
            food.read(pinnekjøtt, function(err, res) {
              assert(!err);
              assert(res.drink);
              assert.equal(res.drink.name, 'Humlekanon');
              done();
            });
          });
        });
      });
    });
    it('it should not save transient compositions', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'drink', 'goes_with', {
        transient: true
      });

      food.save({name:'Pinnekjøtt'}, function(err, pinnekjøtt) {
        assert(!err);
        beer.save({name: 'Humlekanon'}, function(err, hk) {
          assert(!err);
          db.relate(pinnekjøtt, 'goes_with', hk, function(err) {
            assert(!err);
            food.read(pinnekjøtt, function(err, res) {
              assert(!err);
              assert(res.drink);
              assert.equal(res.drink.name, 'Humlekanon');
              res.drink.name = 'Lervig Rye IPA';
              food.save(res, function(err) {
                assert(!err);
                food.read(res, function(err, res2) {
                  assert(!err);
                  assert(res2.drink);
                  assert.equal(res2.drink.name, 'Humlekanon');
                  done();
                });
              });
            });
          });
        });
      });
    });
    it('should not run before-save comp events on transient compositions', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'drink', 'goes_with', {
        transient: true
      });
      beer.on('validate', function(obj, cb) { cb(true) });

      food.save({name:'Pinnekjøtt', drink: {name: 'Humlekanon'}}, function(err, pinnekjøtt) {
        assert(!err);
        done()
      });
    });
    it('should not run after-save comp events on transient compositions', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'drink', 'goes_with', {
        transient: true
      });
      beer.on('afterSave', function(obj, cb) { assert(false) });

      food.save({name:'Pinnekjøtt', drink: {name: 'Humlekanon'}}, function(err, pinnekjøtt) {
        assert(!err);
        done()
      });
    });
    it('it should allow exclusion of composed models on save', function(done) {
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
        meal.matchingBeers[0].name = 'Potato';
        meal.matchingBeers[1].name = 'Gross';
        meal.name = 'Burger';
        food.save(meal, true, function(err, newMeal) {
          assert(!err);
          assert.equal(newMeal.name, 'Burger');
          food.read(newMeal, function(err, newerMeal) {
            assert(!err);
            assert.equal(newerMeal.matchingBeers[0].name, 'Heady Topper');
            assert.equal(newerMeal.matchingBeers[1].name, 'Hovistuten');
            assert.equal(newerMeal.name, 'Burger');
            done()
          });
        });
      });

    });
    it('it should not fire beforeSave event on excluded compositions', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');

      beer.on('validate', function(obj, cb) { cb(true) });

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, true, function(err, meal) {
        assert(!err, err);
        done();
      });
    });
    it('it should not fire afterSave event on excluded compositions', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');

      beer.on('afterSave', function(obj) { assert(false) });

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]},true, function(err, meal) {
        assert(!err, err);
        done();
      });
    });
    it('it should allow saving of only a composition', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      var ingredient = model(db, 'Ingredient');
      food.compose(beer, 'matchingBeers', 'matches', {many:true});
      food.compose(ingredient, 'ingredients', 'contains', {many:true});

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ], ingredients:[ {name: 'Lamb'}]}, function(err, meal) {
        assert(!err,err);
        var beers = [{name: 'Hopwired'}, {name: 'Hop Zombie'},
                      meal.matchingBeers[0]];
        food.saveComposition(meal.id, 'matchingBeers', beers, function(err, beers) {
          assert(!err);
          assert.equal(beers[0].name, 'Hopwired');
          assert(beers[0].id);
          food.read(meal.id, function(err, meal) {
            assert(!err);
            assert.equal(meal.name, 'Pinnekjøtt');
            assert.equal(meal.ingredients[0].name, 'Lamb');

            var beerNames = _.pluck(meal.matchingBeers, 'name');

            assert(_.contains(beerNames, 'Hopwired'));
            assert(_.contains(beerNames, 'Hop Zombie'));
            assert(_.contains(beerNames, 'Heady Topper'));
            assert(!_.contains(beerNames, 'Hovistuten'));

            done();
          });
        });
      });

    });
    it('should not compute beyond a certain level if desired', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      var hop = model(db, 'Hop');
      food.compose(beer, 'matchingBeers', 'matches');
      beer.compose(hop, 'hops', 'contains_hop');

      hop.addComputedField('compute_test', function(thing) { return true });

      food.save({name:"Pinnekjøtt", matchingBeers:
        {name:"Heady Topper", hops: {name: 'CTZ'}},
      }, function(err, meal) {
        assert(!err);
        food.read(meal.id, {computeLevels:1}, function(err, meal) {
          assert(!err,err);
          console.log(meal.matchingBeers);
          assert(!meal.matchingBeers.hops.compute_test)
          done();
        });
      });
    });
    it('should allow implicit transformation of compositions', function(done) {
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
        beer.read(meal.matchingBeers[0].id, function(err, model) {
          assert(!err);
          assert.deepEqual(model, meal.matchingBeers[0]);
          meal.matchingBeers.push({name: 'New Beer!'});
          food.save(meal, function(err, meal) {
            assert(!err);
            assert.equal(meal.matchingBeers.length, 3)
            beer.read(meal.matchingBeers[2].id, function(err, model) {
              assert(!err)
              assert.deepEqual(model, meal.matchingBeers[2]);
              done()
            });
          });
        });
      });
    });
    it('it should allow more than one level of nested composition', function(done) {
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
    it('it should fire the before and after save events for composed models', function(done) {
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
    it('should fire beforeSave and afterSave events for pushComposition', function(done) {
      var beforeFoodSaveCount = 0,
          afterFoodSaveCount = 0;

      var beer = model(db, 'Beer');
      var food = model(db, 'Food');

      food.on('beforeSave', function() { ++beforeFoodSaveCount });
      food.on('afterSave', function() { ++afterFoodSaveCount });

      food.compose(beer, 'matchingBeers', 'matches');

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err);
        assert(beforeFoodSaveCount == 1);
        assert(afterFoodSaveCount == 1);
        food.push(meal, 'matchingBeers', { name: 'Pacific IPA' }, function(err, meal) {
          assert(!err);
          assert(beforeFoodSaveCount == 2);
          assert(afterFoodSaveCount == 2);
          done();
        });
      });
    });
    it('should fire beforeSave and afterSave events for saveComposition', function(done) {
      var beforeFoodSaveCount = 0,
          afterFoodSaveCount = 0;

      var beer = model(db, 'Beer');
      var food = model(db, 'Food');

      food.on('beforeSave', function() { ++beforeFoodSaveCount });
      food.on('afterSave', function() { ++afterFoodSaveCount });

      food.compose(beer, 'matchingBeers', 'matches');

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err);
        assert(beforeFoodSaveCount == 1);
        assert(afterFoodSaveCount == 1);
        food.saveComposition(meal, 'matchingBeers', { name: 'Pacific IPA' }, function(err, meal) {
          assert(!err);
          assert(beforeFoodSaveCount == 2);
          assert(afterFoodSaveCount == 2);
          done();
        });
      });
    });
    it('should handle presave async transforms', function(done) {
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
        db.readLabels(meal.matchingBeers[0].id, function(err, labels) {
          assert(!err, err);
          assert.equal(labels[0], 'Beer');
          db.readLabels(meal.id, function(err, labels) {
            assert.equal(labels[0], 'Food');
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
        food.read(meal, 4, function(err, readMeal) {
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
          food.read(meal, 3,  function(err, meal) {
            assert(meal.name == 'Pinnekjøtt');
            assert(meal.matchingBeers.name == 'Blekfjellet');
            assert(meal.matchingBeers.hops.name == 'El Dorado');
            assert(meal.matchingBeers.hops.aa.percent == '10%');
            done();
          });
        });
      });
    });
    it('should push to a composition', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err);
        food.push(meal, 'matchingBeers', {name:'Super tasty ale'},
        function(err, ale) {
          assert(!err);
          assert(ale.id);
          assert.equal(ale.name, 'Super tasty ale');
          food.read(meal, function(err, meal) {
            assert(!err);
            assert.equal(meal.matchingBeers[0].name, 'Heady Topper');
            assert.equal(meal.matchingBeers[1].name, 'Hovistuten');
            assert.equal(meal.matchingBeers[2].name, 'Super tasty ale');
            done()
          });
        });
      });
    });

    it('should order a composition', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches', {
        orderBy: 'abv'
      });

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper", abv:5},
        {name:"Hovistuten", abv:4}
      ]}, function(err, meal) {
        assert(!err);
        assert.equal(meal.matchingBeers[0].name, 'Hovistuten');
        assert.equal(meal.matchingBeers[1].name, 'Heady Topper');
        food.push(meal, 'matchingBeers', {name:'Super tasty ale', abv:3},
        function(err, ale) {
          assert(!err);
          assert(ale.id);
          assert.equal(ale.name, 'Super tasty ale');
          food.read(meal, function(err, meal) {
            assert(!err);
            assert.equal(meal.matchingBeers[2].name, 'Heady Topper');
            assert.equal(meal.matchingBeers[1].name, 'Hovistuten');
            assert.equal(meal.matchingBeers[0].name, 'Super tasty ale');
            done()
          });
        });
      });
    });

    it('should push multiple nodes to a composition', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err);
        food.push(meal, 'matchingBeers', [{name:'Super tasty ale'},
          {name:'Vildhjarta'}],
        function(err, ale) {
          assert(!err);
          assert(ale[0].id);
          assert(ale[1].id);
          assert.equal(ale[0].name, 'Super tasty ale');
          assert.equal(ale[1].name, 'Vildhjarta');
          food.read(meal, function(err, meal) {
            assert(!err);
            assert.equal(meal.matchingBeers[0].name, 'Heady Topper');
            assert.equal(meal.matchingBeers[1].name, 'Hovistuten');
            assert.equal(meal.matchingBeers[2].name, 'Super tasty ale');
            assert.equal(meal.matchingBeers[3].name, 'Vildhjarta');
            done()
          });
        });
      });
    });
    it('should push saved nodes to a composition', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');

      food.save({name:"Pinnekjøtt", matchingBeers:[
        {name:"Heady Topper"},
        {name:"Hovistuten"}
      ]}, function(err, meal) {
        assert(!err);
        beer.save({name:'Super tasty ale'}, function(err, tastyAle) {
          assert(!err);
          food.push(meal, 'matchingBeers', tastyAle, function(err, ale) {
            assert(!err);
            assert(ale.id);
            assert.equal(ale.name, 'Super tasty ale');
            food.read(meal, function(err, meal) {
              assert(!err);
              assert.equal(meal.matchingBeers[0].name, 'Heady Topper');
              assert.equal(meal.matchingBeers[1].name, 'Hovistuten');
              assert.equal(meal.matchingBeers[2].name, 'Super tasty ale');
              done()
            });
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
      food.compose(beer, 'matchingBeers', 'matches', {many:true});

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

    it ('should allow custom queries and add compositions', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches');

      food.save(
        {name:"Pinnekjøtt", matchingBeers: [{name:"Heady Topper"}] },
        function(err, meal) {
          assert(!err);
          food.query("MATCH (node:Food) WHERE id(node) = {id}", { id: meal.id }, function(err, results) {
            assert(!err);
            assert(Array.isArray(results));
            assert.deepEqual(results[0], meal);
            done();
          });
        });
    });
  });

  describe('uniqueness', function() {
    it('should be able to set a unique key', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.setUniqueKey('name', false, function(err) {
        assert(!err);
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
    });
    it('should be able to set a unique key and use return-old mode', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.setUniqueKey('name', true, function(err) {
        assert(!err);
        beer.save({name: 'Pacific Ale'}, function(err, ale) {
          assert(!err);
          assert(ale.id);
          assert.equal(ale.name, 'Pacific Ale');
          beer.save({name: 'Pacific Ale', otherThing: 1}, function(err, ale2) {
            assert(!err);
            assert.equal(ale2.otherThing, 1);
            beer.read(ale.id, function(err, ale3) {
              assert(!err);
              assert.equal(ale3.otherThing, 1);
              assert.deepEqual(ale2, ale3);
              done();
            });
          });
        });
      });
    });
    it('should support multiple composited nodes it return-old mode', function(done) {
      var beer = model(db, 'Beer');
      var tag = model(db, 'Tag' + Date.now());
      beer.compose(tag, 'tags', 'tagged');
      tag.setUniqueKey('tag', true, function(err) {
        assert(!err);
        beer.save({name:'Abstrakt AB:13', tags: [{tag:'tag'}, {tag:'tag2'}]}, function(err, obj) {
          assert(!err, err);
          assert(obj.name);
          assert(obj.id);
          assert(obj.tags[0].id);
          done();
        });
      });
    });
    it('should enforce uniqueness on composed models', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.setUniqueKey('name', false, function(err) {
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
            assert.equal(err.statusCode, 409);
            done();
          });
        });
      });
    });
    it('should support updating', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.setUniqueKey('name', function(err) {
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

  describe('Timestamps', function() {
    it('should add timestamps', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.useTimestamps();
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        assert(ale.created);
        assert(typeof ale.created == 'number');
        assert(ale.created <= require('moment')().valueOf());
        assert(ale.updated);
        assert(typeof ale.updated == 'number');
        assert(ale.updated <= require('moment')().valueOf());
        done();
      });
    });
    it('should add timestamps with custom names', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.useTimestamps('created_at', 'updated_at');
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        assert(ale.created_at);
        assert(ale.updated_at);
        assert(!ale.created);
        assert(!ale.updated);
        done();
      });
    });
    it('should update the updated timestamp upon saving', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.useTimestamps();
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        var updated = ale.updated;
        setTimeout(function() {
          ale.amazing = 'thing';
          beer.save(ale, function(err, ale) {
            assert(!err);
            assert(ale.updated > updated);
            done()
          });
        }, 50);
      });
    });
    it('should not update the created timestamp upon saving', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.useTimestamps();
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        var created = ale.created;
        setTimeout(function() {
          ale.amazing = 'thing';
          beer.save(ale, function(err, ale) {
            assert(!err);
            assert(ale.created == created);
            done()
          });
        }, 50);
      });
    });
    it('should not update the created timestamp upon saving with fields', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.fields = ['name'];
      beer.useTimestamps();
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        var created = ale.created;
        setTimeout(function() {
          ale.amazing = 'thing';
          beer.save(ale, function(err, ale) {
            assert(!err);
            assert(ale.created == created);
            done()
          });
        }, 50);
      });
    });
    it('should update updated when touched', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.useTimestamps();
      beer.save({name: 'Pacific Ale'}, function(err, ale) {
        assert(!err);
        var updated = ale.updated;
        setTimeout(function() {
          beer.touch(ale, function(err, ale) {
            assert(!err);
            assert(ale.updated > updated);
            done()
          });
        }, 50);
      });
    });
    it('should update root timestamp of composition when editing a detached child', function(done) {
      var beer = model(db, 'Beer');
      var food = model(db, 'Food');
      food.compose(beer, 'matchingBeers', 'matches', {
        updatesTimestamp: true
      });
      food.useTimestamps();

      food.save(
        {name:"Pinnekjøtt", matchingBeers: {name:"Heady Topper"} },
        function(err, meal) {
          assert(!err);
          var abeer = meal.matchingBeers;
          var updated = meal.updated;
          setTimeout(function() {
            abeer.stuff = 'things';
            beer.save(abeer, function(err, node) {
              setTimeout(function() {
                food.read(meal, function(err, node) {
                  assert(node.updated > updated);
                  done();
                });
              },100);
            });
          }, 50);
        });
    });
  });

  describe('Computed fields', function() {
    it('should add a computed field', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.addComputedField('title', function(obj) {
        return obj.brewery + ' ' + obj.beer;
      });
      beer.save({
        brewery: 'Sierra Nevada',
        beer: 'Pale Ale'
      }, function(err, brew) {
        assert(!err);
        assert.equal(brew.title, 'Sierra Nevada Pale Ale');
        beer.read(brew, function(err, brew) {
          assert.equal(brew.title, 'Sierra Nevada Pale Ale');
          done();
        });
      });
    });
    it('should add multiple computed fields with a single computer', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.addComputer(['title', 'date_read'], function(obj, cb) {
        obj.title = obj.brewery + ' ' + obj.beer;
        obj.date_read = 'today';
        cb(null,obj)
      });
      beer.save({
        brewery: 'Sierra Nevada',
        beer: 'Pale Ale'
      }, function(err, brew) {
        assert(!err);
        assert.equal(brew.title, 'Sierra Nevada Pale Ale');
        assert.equal(brew.date_read, 'today');
        beer.read(brew, function(err, brew) {
          assert.equal(brew.title, 'Sierra Nevada Pale Ale');
          assert.equal(brew.date_read, 'today');
          done();
        });
      });
    });
    it('shouldn\'t actually save computed field', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.addComputedField('title', function(obj) {
        return obj.brewery + ' ' + obj.beer;
      });
      beer.save({
        brewery: 'Sierra Nevada',
        beer: 'Pale Ale'
      }, function(err, brew) {
        assert(!err);
        assert.equal(brew.title, 'Sierra Nevada Pale Ale');
        db.read(brew, function(err, brew) {
          assert(!brew.title);
          done();
        });
      });
    });
    it('shouldn\'nt save multiple computed fields with a single computer', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.addComputer(['title', 'date_read'], function(obj, cb) {
        obj.title = obj.brewery + ' ' + obj.beer;
        obj.date_read = 'today';
        cb(null,obj)
      });
      beer.save({
        brewery: 'Sierra Nevada',
        beer: 'Pale Ale'
      }, function(err, brew) {
        assert(!err);
        assert.equal(brew.title, 'Sierra Nevada Pale Ale');
        assert.equal(brew.date_read, 'today');
        db.read(brew, function(err, brew) {
          assert(!err, err);
          assert(brew.title == null);
          assert(brew.date_read == null);
          done();
        });
      });
    });
    it('should add an async computed field', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.addComputedField('title', function(obj, cb) {
        setTimeout(function() {
          cb(null, obj.brewery + ' ' + obj.beer);
        }, 200);
      });
      beer.save({
        brewery: 'Sierra Nevada',
        beer: 'Pale Ale'
      }, function(err, brew) {
        assert(!err);
        assert.equal(brew.title, 'Sierra Nevada Pale Ale');
        beer.read(brew, function(err, brew) {
          assert.equal(brew.title, 'Sierra Nevada Pale Ale');
          done();
        });
      });
    });
    it('should compute fields when using `where`', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.addComputedField('stuff', function(stuff) {
        return 'omg';
      });
      beer.save({name:'beer'}, function(err, beer1) {
        assert(!err);
        beer.save({name:'beer'}, function(err, beer2) {
          assert(!err);
          beer.where({name:'beer'}, function(err, beers) {
            assert(!err);
            assert(beers.length == 2);
            assert.equal(beers[0].stuff, 'omg');
            assert.equal(beers[1].stuff, 'omg');
            done();
          });
        });
      });
    });
    it('should compute fields when using `findAll`', function(done) {
      var beer = model(db, 'Beer'+Date.now());
      beer.addComputedField('stuff', function(stuff) {
        return 'omg';
      });
      beer.save({name:'beer'}, function(err, beer1) {
        assert(!err);
        beer.save({name:'beer'}, function(err, beer2) {
          assert(!err);
          beer.findAll(function(err, beers) {
            assert(!err);
            assert(beers.length == 2);
            assert.equal(beers[0].stuff, 'omg');
            assert.equal(beers[1].stuff, 'omg');
            done();
          });
        });
      });
    });
    it('should work on composed models', function(done) {
      var food = model(db, 'Food'+Date.now());
      var beer = model(db, 'Beer'+Date.now());
      beer.addComputedField('title', function(obj, cb) {
        setTimeout(function() {
          cb(null, obj.brewery + ' ' + obj.beer);
        }, 200);
      });
      food.compose(beer, 'beer', 'has_beer');
      food.save({
        dish: 'Irish Stew',
        beer: {
          brewery: 'Nøgne Ø',
          beer: 'Imperial Stout'
        }
      }, function(err, meal) {
        assert(!err);
        assert.equal(meal.beer.title, 'Nøgne Ø Imperial Stout');
        food.read(meal, function(err, meal) {
          assert(!err);
          assert.equal(meal.beer.title, 'Nøgne Ø Imperial Stout');
          done();
        });
      });
    });
  });
  describe('Schemas', function() {
    describe('validation: fail', function() {
      it('should fail save call when validation fails: required', function(done) {
        var beer = model(db, 'Beer');
        beer.schema = {
          type: String,
          age: { type: Number, required: true }
        };

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
        var beer = model(db, 'Beer');
        beer.schema = {
          email: {type: String, match: emailRegEx }
        };

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
        var beer = model(db, 'Beer');
        beer.schema = {
          type: {type: String, enum: BEER_TYPE}
        };

        var ipa = {type:'IPA'};
        beer.save(ipa, function(err, savedipa) {
          assert.ok(err);
          assert(!savedipa);
          assert(!ipa.id);
          done();
        });
      });
      it('should fail save call when validation fails: min/max', function(done) {
        var beer = model(db, 'Beer');
        beer.schema = {
          type: String,
          age: { type: Number, min: 16, max: 65 }
        };

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
        var beer = model(db, 'Beer');
        beer.schema = {
          created: {type: Date}
        };

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
        var beer = model(db, 'Beer');
        beer.schema = {
          type: String,
          age: { type: Number, required: true }
        };

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
        var beer = model(db, 'Beer');
        beer.schema = {
          email: {type: String, match: emailRegEx }
        };

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
        var beer = model(db, 'Beer');
        beer.schema = {
          type: {type: String, enum: BEER_TYPE}
        };

        var ipa = {type:'stout'};
        beer.save(ipa, function(err, savedipa) {
          assert(!err);
          assert(savedipa);
          assert(savedipa.type === 'stout');
          done();
        });
      });
      it('should pass save call when validation passes: min/max', function(done) {
        var beer = model(db, 'Beer');
        beer.schema = {
          type: String,
          age: { type: Number, min: 16, max: 65 }
        };

        var ipa = {type:'IPA', age: 25};
        beer.save(ipa, function(err, savedipa) {
          assert(!err);
          assert(savedipa);
          assert(savedipa.age === 25);
          done();
        });
      });
      it('should pass save call when cast passes', function(done) {
        var beer = model(db, 'Beer');
        beer.schema = {
          created: {type: Date}
        };

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
        var beer = model(db, 'Beer');
        beer.schema = {
          type: {type: String, trim:true }
        };

        var ipa = {type:'IPA   '};
        beer.save(ipa, function(err, savedipa) {
          assert(!err);
          assert(savedipa);
          assert(savedipa.type === 'IPA');
          done();
        });
      });
      it('should lowercase a string', function(done) {
        var beer = model(db, 'Beer');
        beer.schema = {
          type: {type: String, lowercase: true}
        };

        var ipa = {type:'IPA', age:25};
        beer.save(ipa, function(err, savedipa) {
          assert(!err);
          assert(savedipa);
          assert(savedipa.type === 'ipa');
          done();
        });
      });
      it('should uppercase a string', function(done) {
        var beer = model(db, 'Beer');
        beer.schema = {
          type: {type: String, uppercase: true}
        };

        var ipa = {type:'ipa', age:25};
        beer.save(ipa, function(err, savedipa) {
          assert(!err);
          assert(savedipa);
          assert(savedipa.type === 'IPA');
          done();
        });
      });
    });
  });
});
