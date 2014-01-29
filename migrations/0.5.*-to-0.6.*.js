var async = require('async');
module.exports = function(db, models, migrateTimestamps, migrateTimestampsFn, callback) {
  if (typeof migrateTimestamps == 'function') {
    callback = migrateTimestamps;
    migrateTimestamps = true;
    migrateTimestampsFn = function(ts) { return ts * 1000; };
  }

  if (migrateTimestamps && !callback) {
    callback = migrateTimestampsFn;
    migrateTimestampsFn = function(ts) { return ts * 1000; };
  }

  if (!migrateTimestamps && !callback) {
    callback = migrateTimestampsFn;
  }

  console.log('fetching all model nodes...');
  var nodetxn = db.batch();
  var modelNodes = models.map(function(model) {
    return nodetxn.legacyindex.readAsList('nodes', 'type', model.type);
  });
  nodetxn.commit(function(err, results) {
    if (err) {
      if (err.message.match(/NotFoundException/) && err.message.match(/getIndexedNodes/i)) {
        console.log('aborting migration, no nodes in database are indexed as <0.6.0 seraph models');
        return callback();
      }
      console.log("failed to retrieve nodes", err);
      return callback(err);
    }

    modelNodes = modelNodes.map(function(idx, i) {
      console.log("got", results[idx].length, "nodes of type '", models[i].type, "'");
      return results[idx];
    });

    var txn = db.batch();

    modelNodes.forEach(function (nodes, i) {
      var model = models[i];
      txn.label(nodes, model.type);

      if (!model.useTimestamps || !migrateTimestamps) return;

      nodes.forEach(function(node) {
        txn.save(node, model.createdField, migrateTimestampsFn(node[model.createdField]));
        txn.save(node, model.updatedField, migrateTimestampsFn(node[model.updatedField]));
      });
    });

    txn.legacyindex.delete('nodes');
    console.log("labelling nodes, deleting redundant seraph-model indexes", migrateTimestamps ? "and updating timestamps" : "");
    txn.commit(function(err) {
      if (err) {
        console.log("migration failed, no changes made. err follows");
        console.log(err);
        callback(err);

      }
      else callback();
    });
  });
};

