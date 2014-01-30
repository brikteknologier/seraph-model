var transformComps = require('./transform-composed-nodes'),
    async = require('async'),
    _ = require('underscore'),
    compositionRelationCypherList = require('./composition-relation-cypher-list')
    sortComps = require('./sort-compositions');

module.exports = {
  read: function(node, opts, callback) {
    var self = this;

    if (typeof node == 'function') {
      callback = node;
      opts = { depth: 2 };
      node = null;
    } else if (typeof opts == 'function') {
      callback = opts;
      opts = { depth: 2 };
    }

    var id = node == null ? null : this.db._getId(node);

    if (typeof opts == 'number') opts = { depth: opts };
    
    var depth = opts.depth == null ? 2 : opts.depth;

    if (opts.restrictToComp) {
      if (!this.compositions[opts.restrictToComp])
        callback(new Error(opts.restrictToComp + " is not a valid composition"));
      ++depth;
    }

    if (!Object.keys(this.compositions).length) depth = 0;

    var query = [];
    var params = {};

    if (opts.query) {
      query.push(opts.query);
      query.push('WITH ' + (opts.varName || 'node') + ' as root');
      if (opts.params)
        params = _.extend(opts.params, params);
    }

    query.push('MATCH (root:' + this.type + ')');

    if (id != null) {
      query.unshift('START root = node({__sm_root})')
      params['__sm_root'] = id;
    }

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

    this.db.query(query.join(' '), params, function(err, data) {
      if (err) {
        if (err.neo4jException == 'EntityNotFoundException') callback(null, false);
        else callback(err);
        return;
      };
      if (data.__ts) return self.compute(data.root, callback);
      if (!data.length) return callback(null, id == null ? data : false);
  
      async.map(data, function(data, callback) {
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
            sortComps.call(self, node);
            if (opts.restrictToComp)
              callback(null, node[opts.restrictToComp]);
            else
              self.compute(node, callback);
          }
        });
      }, function(err, data) {
        if (err) return callback(err);
        callback(null, id == null ? data : data[0]);
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
