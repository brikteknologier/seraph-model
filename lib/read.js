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
  read_old: function(idOrObj, callback) {
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
  read: function(node, opts, callback) {
    var id = this.db._getId(node);
    var self = this;

    if (typeof opts == 'function') {
      callback = opts;
      opts = { depth: 2 };
    }

    if (typeof opts == 'number') opts = { depth: opts };
    
    var depth = opts.depth == null ? 2 : opts.depth;

    if (opts.restrictToComp) {
      if (!this.compositions[opts.restrictToComp])
        callback(new Error(opts.restrictToComp + " is not a valid composition"));
      ++depth;
    }

    if (!Object.keys(this.compositions).length) depth = 0;

    var query = [ 'START root = node({root})' ];

    var comps;
    var compMapping = [];
    for (var level = 0; level < depth; ++level) {
      if (!comps) comps = opts.restrictToComp 
                            ? [ this.compositions[opts.restrictToComp] ]
                            : _.values(this.compositions);
      else comps = _.flatten(comps.map(function(comp) {
          return _.values(comp.model.compositions);
        }), true);

      if (!comps.length) {
        depth = level;
        break;
      }

      compMapping.push(_.object(_.pluck(comps, 'rel'), comps));

      var rels = compositionRelationCypherList(comps);
      var start = level ? 'level' + (level - 1) : 'root';
      query.push('OPTIONAL MATCH');
      query.push(start + '-[r' + level + ':' + rels + ']->(level' + level + ')');
    }

    var returnVars = ['root', 'timestamp() as __ts'];
    for (var level = 0; level < depth; ++level) {
      returnVars.push('COLLECT( level' + level + ' ) as level' + level);
      returnVars.push('COLLECT( DISTINCT r' + level + ' ) as r' + level);
    }

    query.push("RETURN " + returnVars.join(','));

    this.db.query(query.join(' '), { root: id }, function(err, data) {
      if (err) return callback(err);
      if (data.__ts) return self.compute(data.root, callback);
  
      data = data[0];
      var node = data.root;

      async.forEach(_.range(depth -1, -1, -1), function(level, callback) {
        var startNodes = data['level' + (level - 1)] || [node];
        var endNodes = data['level' + level];
      
        var rels = data['r' + level];
        
        async.forEach(rels, function(rel, callback) {
          var start = _.find(startNodes, function(node) {
            return node[self.db.options.id] == rel.start;
          });
          var end = _.find(endNodes, function(node) {
            return node[self.db.options.id] == rel.end;
          });

          var comp = compMapping[level][rel.type];
          self.compute.call(comp.model, end, function(err, end) {
            if (err) return callback(err);

            if (start[comp.name]) {
              if (Array.isArray(start[comp.name])) start[comp.name].push(end);
              else start[comp.name] = [ start[comp.name], end ];
            } else start[comp.name] = comp.many ? [ end ] : end;

            callback();
          });
        }, callback);
      }, function(err) {
        if (err) callback(err);
        else {
          if (opts.restrictToComp)
            callback(null, node[opts.restrictToComp]);
          else
            //todo sort comps
            self.compute(node, callback);
        }
      });
    });
  },
  readComposition: function(node, comp, depth, callback) {
    if (typeof depth == 'function') {
      callback = depth;
      depth = 2;
    }
    module.exports.read.call(this, node, { restrictToComp: comp, depth: depth }, callback);
  }
}
