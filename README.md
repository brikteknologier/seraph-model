__seraph_model__ provides some convenient functions for storing and retrieving
typed nodes from a neo4j database. It is intended to work with 
[seraph](https://github.com/brikteknologier/seraph). 

<a name="quick"/>
### Quick example

```javascript
var db = require('seraph')('http://localhost:7474')
var model = require('seraph_model');

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
* [Adding indexers](#indexers)
* [beforeSave/afterSave events](#saveevents)
* [Setting a properties whitelist](#settingfields)

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

<a name="indexers"/>
## Adding indexers
__Indexers__ are functions that are called with an object immediately after it
has been saved for the first time.

They are passed the object and a callback: you are expected to do all of the
indexing yourself. The callback takes one argument, an `err`. This is a
dangerous place to return an error however, as the afterSave event has not yet
been fired, but the object _has_ been saved. Regardless, returning an error here
will trigger the callback of the entire save event immediately, with the error
you pass. The afterSave event will not be fired.

You can manually index an object by calling `model.index(obj, callback)`.

### Example 

```javascript
model.on('index', function(obj, cb) {
  db.index('wobblebangs', obj, 'uuid', createUuid(), cb);
});
```

<a name="saveevents"/>
## Save events

There's a few events you can listen on:

* `beforeSave` fired after preparation and validation, but before saving.
* `afterSave` fired after saving and indexing. 

These listeners do not take a callback.

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
stripped.

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
are not included in this array are stripped. See 
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
