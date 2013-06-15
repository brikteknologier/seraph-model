__seraph_model__ provides some convenient functions for storing and retrieving
typed nodes from a neo4j database. It is intended to work with 
[seraph](https://github.com/brikteknologier/seraph). 

<a name="quick"/>
### Quick example

```javascript
var db = require('seraph')('http://localhost:7474')
var model = require('seraph-model');

var User = model(db, 'user');

User.save({ name: 'Jon', city: 'Bergen' }, function(err, saved) {
  if (err) throw err;

  User.findAll(function(err, allUsers) {
    // allUsers -> [{ name: 'Jon', city: 'Bergen', id: 0 }]
  });
  User.where({ city: 'Bergen' }, function(err, usersFromBergen) {
    // usersFromBergen -> all user objects with city == bergen
  });
})

```

# Documentation

## How to do things

* [Creating a new Model](#create)
* [Adding preparers](#preparation)
* [Adding validators](#validation)
* [Adding indexes](#indexes)
* [beforeSave/afterSave events](#saveevents)
* [Setting a properties whitelist](#settingfields)
* [Composition of models](#composition)

## Model instance methods
* [model.read](#read)
* [model.exists](#exists)
* [model.save](#save)
* [model.findAll](#findAll)
* [model.where](#where)
* [model.prepare](#prepare)
* [model.validate](#validate)
* [model.fields](#fields)
* [model.cypherStart](#cypherStart)

<a name="create"/>
## Creating a new model

__seraph_model(seraphDbObject, modelTypeName)__

You can create a new model by calling the function returned by requiring
`seraph_model`. There are no instances of this model, only objects, which are 
passed to the model itself in order to perform work on it. Much like seraph
itself.

It works by indexing each object under a `nodes` index. Each different model is
simply an item in that index, with all of the instances of that model attached
to it.

Each model is also indexed by its id upon saving the first time. This ensures
that when reading models, you do not read models of other types.

### Example
```javascript
var db = require('seraph')('http://localhost:7474');
var Beer = require('seraph_model')(db, 'beer');

Beer.save({name: 'Pacific Ale', brewery: 'Stone & Wood'}, function(err, beer) {
  // saved!
});
```

<a name="preparation"/>
## Adding preparers

__Preparers__ are functions that are called upon an object to transform it
before saving it. A preparer is a function that takes an object and a callback,
and calls back with an error and the updated object.

Preparers can also do validation. If a preparer returns an error, it will be
passed to the save callback as if it were a validation error. However, if you
just want to do validation and not mutate the object, use a
[validator](#validation) instead.

You can manually prepare an object by using the [model.prepare](#prepare)
function.

### Example

```javascript
var prepareFileSize = function(object, callback) {
  fs.stat(object.file, function(err, stat) {
    if (err) return callback('There was an error finding the file size');
    object.filesize = stat.size;
    callback(null, object);
  });
}

model.on('prepare', prepareFileSize);

model.save({file: 'foo.txt'}, function(err, object) {
  // object -> { file: 'foo.txt', filesize: 521, id: 0 }
});

mode.save({file: 'nonexistant.txt'}, function(err, object) {
  // err -> 'There was an error finding the file size'
});
```

<a name="validation"/>
## Adding validators
__Validators__ are functions that are called with an object before it is saved.
If they call back with anything that is not falsy, the saving process is halted,
and the error from the validator function is returned to the save callback.

You can manually validate an object by using the [model.validate](#validate)
function.

### Example

```javascript
var validateAge = function(person, callback) {
  if (object.age >= 21) {
    callback();
  } else {
    callback('You must be 21 or older to sign up!');
  }
}

model.on('validate', validateAge);

model.save({ name: 'Jon', age: 23 }, function(err, person) {
  // person -> { name: 'Jon', age: 23, id: 0 }
});

model.save({ name: 'Jordan', age: 17 }, function(err, person) {
  // err -> 'You must be 21 or older to sign up!'
});
```

<a name="indexes"/>
## Adding indexes

### `addIndex(indexName, key, value[, shouldIndex])`

You can add any number of indexes to add an object to upon saving by using the
`addIndex` function. Objects are
only indexed the first time they are saved, but you can manually index an object
by calling the `index` function. 

They keys and values passed to `addIndex` can be computed, but that is optional.
If they are computed, you must pass the resultant key or value to a callback,
rather than returning it (this gives you the opportunity to do asynchronous
calculations at this point).

You also have the option of passing a function to determine weather or not
the index is used at all.

### Example 

With static keys/values

```javascript
model.addIndex('wobblebangs', 'bangs', 'wobbly');
```

With computed value
```javascript
model.addIndex('uniquely_identified_stuff', 'stuff', function(obj, cb) {
  cb(null, createUuid());
});
```

With computed key and value
```javascript
model.addIndex('things',
  function(obj, cb) { cb(null, obj.model); },
  function(obj, cb) { cb(null, obj.id); });
```

With conditional indexing
```javascript
model.addIndex('some_stuff', 'things', 'cool', function(obj, cb) {
  var isCoolEnough = obj.temperature < 20;
  cb(null, isCoolEnough); //objs with `temperature` >= 20 are not indexed
});
```

<a name="saveevents"/>
## Save events

There's a few events you can listen on:

* `beforeSave` fired after preparation and validation, but before saving.
* `afterSave` fired after saving and indexing. 

### Example

```javascript
model.on('beforeSave', function(obj) {
  console.log(obj, "is about to be saved");
})
```

<a name="settingfields"/>
## Setting a properties whitelist

__Fields__ are a way of whitelisting which properties are allowed on an object 
to be saved. Upon saving, all properties which are not in the whitelist are 
stripped. Composited properties are automatically whitelisted.

### Example

```javascript
beer.fields = ['name', 'brewery', 'style'];

beer.save({
  name: 'Rye IPA', 
  brewery: 'Lervig', 
  style: 'IPA',
  country: 'Norway'
}, function(err, theBeer) {
  // theBeer -> { name: 'Rye IPA', brewery: 'Lervig', style: 'IPA', id: 0 }
})
```

<a name="composition"/>
## Composition of Models.

Composition allows you to relate two models so that you can save nested objects
faster, and atomically. When two models are composed, even though you might be
saving 10 objects, only 2 api calls (saving & indexing) will be made, just as if 
you were only saving 1. 

With this, you can also nest objects, which can make your life a bit easier when
saving large objects.

**Composited objects will also be implicitly retrieved when reading from the
database, to infinite depth.** The number of read API calls is variable, and will
expand depending on the level and complexity of your compositions.

**example**

```javascript
var beer = model(db, "Beer");
var hop = model(db, "Hop");

beer.compose(hop, 'hops', 'contains_hop');

var pliny = {
  name: 'Pliny the Elder',
  brewery: 'Russian River',
  hops: [
    { name: 'Columbus', aa: '13.9%' },
    { name: 'Simcoe', aa: '12.3%' },
    { name: 'Centennial', aa: '8.0%' }
  ]
};

// Since objects were listed on the 'hops' key that I specified, they will be 
// saved with the `hop` model, and then related back to my beer.
beer.save(pliny, function(err, saved) {
  // if any of the hops or the beer failed validation with their model, err
  // will be populated and nothing will be saved.
  
  console.log(saved); 
  /* -> { brewery: 'Russian River',
          name: 'Pliny the Elder',
          id: 11,
          hops: 
           [ { name: 'Columbus', aa: '13.9%', id: 12 },
             { name: 'Simcoe', aa: '12.3%', id: 13 },
             { name: 'Centennial', aa: '8.0%', id: 14 } ] }
  */

  db.relationships(saved, function(err, rels) {
    console.log(rels) // -> [ { start: 11, end: 12, type: 'contains_hop', properties: {}, id: 0 },
                      // { start: 11, end: 13, type: 'contains_hop', properties: {}, id: 1 },
                      // { start: 11, end: 14, type: 'contains_hop', properties: {}, id: 2 } ]
  });

  // Read directly with seraph
  db.read(saved, function(err, readPlinyFromDb) {
    console.log(readPliny)
    /* -> { brewery: 'Russian River',
            name: 'Pliny the Elder',
            id: 11 }
    */
  })

  // Read with model, and you get compositions implicitly.
  beer.read(saved, function(err, readPliny) {
    console.log(readPliny)
    /* -> { brewery: 'Russian River',
            name: 'Pliny the Elder',
            id: 11,
            hops: 
             [ { name: 'Columbus', aa: '13.9%', id: 12 },
               { name: 'Simcoe', aa: '12.3%', id: 13 },
               { name: 'Centennial', aa: '8.0%', id: 14 } ] }
    */
  });

  hop.read(14, function(err, hop) {
    console.log(hop); // -> { name: 'Centennial', aa: '8.0%', id: 14 }
  });
});
```

### Updating models with compositions

You can use the regular `model.save` function to update a model with 
compositions on it. If the compositions differ from the previous version of the
model, the relationships to the previously composed nodes will be deleted **but
the nodes themselves will not be**. If you want to update the base model but
don't want the overhead that the compositions involves, you should just use
`db.save` rather than `model.save`.

### model.compose(composedModel, key, relationshipName)

Add a composition.

* `composedModel` — the model which is being composed
* `key` — the key on an object being saved which will contained the composed 
  models.
* `relationshipName` — the name of the relationship that is created between
  a root model and its composed models. These relationships are always outgoing.

### model.readComposition(objectOrId, compositionKey, callback)

Read a single composition from a model.

* `objectOrId` — an id or an object that contains an id that refers to a model.
* `compositionKey` – the composition which to retrieve.
* `callback` — callback for result, format (err, resultingComp). `resulingComp`
  will either be an array of composed objects or a single object if there was
  only one

Example (from the above context)
```javascript
beer.readComposition(pliny, 'hops', function(err, hops) {
  console.log(hops); 
  /* [ { name: 'Columbus', aa: '13.9%', id: 12 },
      { name: 'Simcoe', aa: '12.3%', id: 13 },
      { name: 'Centennial', aa: '8.0%', id: 14 } ]  */
});
```

<a name="save"/>
## model.save(object(s), callback(err, savedObject))

Saves or updates an object in the database. The steps for doing this are:

1. `object` is prepared using [model.prepare](#prepare)
2. `object` is validated using [model.validate](#validate). If validation
   fails, the callback is called immediately with an error.
3. `object` is saved using [seraph.save](https://github.com/brikteknologier/seraph#node.save)
4. `object` is indexed as this type of model using [seraph.index](https://github.com/brikteknologier/seraph#node.index)

The object returned is given an ID. See
[seraph.save](https://github.com/brikteknologier/seraph#node.save) for more 
information and an example (they are operationally identical).

<a name="read"/>
## model.read(idOrObject, callback(err, model))

Reads a model from the database given an id or an object containing the id. 
`model` is either the returned object or `false` if it was not found.

<a name="exists"/>
## model.exists(idOrObject, callback(err, doesExist))

Check if a model exists.

<a name="findAll"/>
## model.findAll(callback(err, allOfTheseModels))

Finds all of the objects that were saved with this type.

<a name="where"/>
## model.where(callback(err, matchingModels))

This is a operationally similar to 
[seraph.find](https://github.com/brikteknologier/seraph#node.find), but is
restricted to searching for other objects indexed as this kind of model. See the
[quick example](#quick) for an example of this in action. 

<a name="prepare"/>
## model.prepare(object, callback(err, preparedObject))

Prepares an object by using the `model.preparers` array of functions to mutate
it. For more information, see [Adding preparers](#preparation)

<a name="validate"/>
## model.validate(object, callback(err, preparedObject))

Validates that an object is ready for saving by calling each of the functions in
the `model.validators` array. For more information, see 
[Adding validators](#validation)

<a name="fields"/>
## model.fields

This is an array of property names which acts as a whitelist for property names
in objects to be saved. If it is set, any properties in objects to be saved that
are not included in this array are stripped. Composited properties are 
automatically whitelisted. See 
[Setting a properties whitelist](#settingfields) for more information and
examples.

<a name="cypherStart"/>
## model.cypherStart()

Returns the appropriate START point for a cypher query for this kind of model.
Example:

```javascript
var beer = model(db, 'Beer');

beer.cypherStart(); // -> 'node:nodes(type = "Beer")'
```

You can then use this in a seraph `find` or `query` call. Example:

```javascript
db.find({type: 'IPA'}, false, beer.cypherStart(), function(err, beers) {
  // beers -> all beers with type == 'IPA'
});
```
