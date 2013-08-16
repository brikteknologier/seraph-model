var transformComps = require('./transform-composed-nodes'),
    async = require('async'),
    _ = require('underscore'),
    awaiter = require('collect').awaiter
    compositionRelationCypherList = require('./composition-relation-cypher-list')
    sortComps = require('./sort-compositions');


function fetchAllCompositedNodes(db, root, comps, callback) {
  var compKeys = Object.keys(comps);
  if (!compKeys.length) return callback(null, {});

  var self = this;
  var compNamesForRels = {};
  compKeys.forEach(function(compName) {
    compNamesForRels[comps[compName].rel] = compName;
  });
  var rels = compositionRelationCypherList(comps);

  var cypher = [
    "START root = node({root})",
    "MATCH root-[r:" + rels + "]->(node)",
    "RETURN type(r) as rel, collect(node) as nodes"
  ].join(" ");

  db.query(cypher, { root: this.db._getId(root) }, function(err, results) {
    if (err) return callback(err);
    if (!Array.isArray(results)) results = [results];

    var comps = {};
    results.forEach(function(result) {
      comps[compNamesForRels[result.rel]] = result.nodes;
    });

    var txn = self.db.batch()
    transformComps.call(self, comps, comps, function(opts, obj, i, cb) {
      fetchAllCompositedNodes.call(opts.model, txn, obj, 
          opts.model.compositions, function(err, comps) {
        if (err) return cb(err);
        opts.model.compute(_.extend(obj, comps), cb);
      });
    }, function(err, results) {
      if (err) return callback(err);
      sortComps.call(self, results);
      callback(null, results);
    });

    if (txn.operations.length > 0) txn.commit();
  });
};

module.exports = {
  read: function(idOrObj, callback) {
    var self = this;
    var id = this.db._getId(idOrObj);

    if (!Object.keys(this.compositions)) {
      return this.db.index.read(this.modelNodeIndex, this.type, id, 
      function(err, obj) {
        if (err) return callback(err);
        self.compute(obj, callback);
      });
    }

    var txn = this.db.batch();
    
    var awaitNodeAndComps = awaiter('node', 'comps');

    txn.index.read(this.modelNodeIndex, this.type, id, awaitNodeAndComps('node'));
    fetchAllCompositedNodes.call(this, txn, id, this.compositions,
        awaitNodeAndComps('comps'));

    txn.commit();

    awaitNodeAndComps.then(function(err, result) {
      if (err) {
        var neo4jerr;
        try {
          neo4jerr = JSON.parse(err.message)
        } catch(e) {
          return callback(err);
        }

        if (neo4jerr.exception == 'EntityNotFoundException' &&
            neo4jerr.cause.exception == 'NotFoundException' &&
            neo4jerr.cause.stacktrace[0].match(/getNodeById/ig)) {
          // Node doesn't exist
          return callback(null, false);
        } else if (neo4jerr.exception == 'NotFoundException' &&
                   neo4jerr.stacktrace[0].match(/getIndexedNodes/ig)) {
          // Nodes index doesn't exist
          return callback(null, false);
        }

        callback(err);
      } else {
        var obj = _.extend(result.node, result.comps);
        self.compute(obj, callback);
      }
    });
  },
  readComposition: function(idOrObj, comp, callback) {
    var id = this.db._getId(idOrObj);
    var compObj = {};
    compObj[comp] = this.compositions[comp];
    var self = this;
    
    if (!comp[0]) return callback(new Error("No such composition: " + comp));

    fetchAllCompositedNodes.call(this, this.db, id, compObj, function(err, res) {
      if (err) return callback(err);
      sortComps.call(self, res);
      callback(null, res[comp]);
    });
  }
}
