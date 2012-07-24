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
* [Setting a properties whitelist](#settingfields)

## Model instance methods
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

model.preparers.push(prepareFileSize);

model.save({file: 'foo.txt'}, function(err, object) {
  // object -> { file: 'foo.txt', filesize: 521, id: 0 }
});

mode.save({file: 'nonexistant.txt'}, function(err, object) {
  // err -> 'There was an error filding the file size'
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

model.validators.push(validateAge);

model.save({ name: 'Jon', age: 23 }, function(err, person) {
  // person -> { name: 'Jon', age: 23, id: 0 }
});

model.save({ name: 'Jordan', age: 17 }, function(err, person) {
  // err -> 'You must be 21 or older to sign up!'
});
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

There is also the internal `model._unsafeSave` method which only performs
steps 3 & 4. However, use of that method is discouraged and unsupported.

The object returned is given an ID. See
[seraph.save](https://github.com/brikteknologier/seraph#node.save) for more 
information and an example (they are operationally identical).

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