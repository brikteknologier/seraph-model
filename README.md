__seraph_model__ provides some convenient functions for storing and retrieving
typed nodes from a neo4j database. It is a thin model layer to sit on top of 
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

* [Create a new model](#create)
* [model.save](#save)
* [model.findAll](#findAll)
* [model.where](#where)

<a name="create"/>
## Creating a new model {#create}

__seraph_model(seraphDbObject, modelTypeName)

You can create a new model by calling the function returned by requiring
`seraph_model`.

It works by indexing each object under a `nodes` index. Each different model is
simply an item in that index, with all of the instances of that model attached
to it.

<a name="save"/>
## model.save(object(s), callback(err, savedObject)) {#save}

Saves or updates an object in the database. This is a composition of the
`seraph.save` and `seraph.index` calls. The object returned is given an ID. See
[seraph.save](https://github.com/brikteknologier/seraph#node.save) for more 
information and an example (they are operationally identical).

<a name="findAll"/>
## model.findAll(function(err, allOfTheseModels))

Finds all of the objects that were saved with this type.

<a name="where"/>
## model.where

This is a operationally similar to 
[seraph.find](https://github.com/brikteknologier/seraph#node.find), but is
restricted to searching for other objects indexed as this kind of model. See the
[quick example](#quick) for an example of this in action. 