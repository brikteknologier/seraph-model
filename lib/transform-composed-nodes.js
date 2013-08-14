var async = require('async');

module.exports = 
  function transformComposedNodes(source, target, iterator, callback) {
    var comps = this.compositions;
    var compKeys = Object.keys(comps);
    async.map(compKeys, function(compKey, callback) {
      var opts = comps[compKey];
      var objects = source[compKey];

      if (!objects) return callback();
      
      //make sure it's an array, we can unwrap it later if it wasn't
      objects = Array.isArray(objects) ? objects : [ objects ];

      async.map(objects, function(object, callback) {
        iterator(opts, object, objects.indexOf(object), callback);
      }, function(err, transformedObjects) {
        if (err) return callback(err);
        
        if (transformedObjects.length == 1 && !opts.many) {
          transformedObjects = transformedObjects[0];
        }

        callback(null, transformedObjects);
      });
    }, function(err, transformedComps) {
      if (err) return callback(err);

      transformedComps.forEach(function(object, i) {
        if (!object) return;
        target[compKeys[i]] = object;
      });

      callback(null, target);
    });
  };
