var transformComps = require('./transform-composed-nodes'),
    async = require('async'),
    _ = require('underscore'),
    compositionRelationCypherList = require('./composition-relation-cypher-list')
    sortComps = require('./sort-compositions');

function assembleReadQuery(opts) {
  opts.depth = opts.depth == null ? 2 : opts.depth;

  if (opts.restrictToComp) {
    if (!this.compositions[opts.restrictToComp])
      callback(new Error(opts.restrictToComp + " is not a valid composition"));
    ++opts.depth;
  }

  if (!Object.keys(this.compositions).length) opts.depth = 0;

  var query = [];
  if (!opts.params) opts.params = {};

  if (opts.query) {
    query.push(opts.query);
    query.push('WITH ' + (opts.varName || 'node') + ' as __sm_root');
    if (Array.isArray(opts.otherVars)) 
      query.push(opts.otherVars.join(','));
  }

  query.push('MATCH (__sm_root:' + this.type + ')');

  if (opts.rootId != null) {
    query.unshift('START __sm_root = node({__sm_root})')
    opts.params['__sm_root'] = opts.rootId;
  }

  var restrictToComp;
  if (opts.restrictToComp) {
    if (Array.isArray(opts.restrictToComp))
      restrictToComp = _.values(_.pick(this.compositions, opts.restrictToComp))
    else 
      restrictToComp = [ this.compositions[opts.restrictToComp] ]
  }

  var comps;
  opts.compMapping = [];

  for (var level = 0; level < opts.depth; ++level) {
    if (!comps) comps = restrictToComp ? restrictToComp : _.values(this.compositions);
    else comps = _.flatten(comps.map(function(comp) {
        return _.values(comp.model.compositions);
      }), true);

    if (!comps.length) {
      opts.depth = level;
      break;
    }

    opts.compMapping.push(_.object(_.pluck(comps, 'rel'), comps));

    var rels = compositionRelationCypherList(comps);
    var start = level ? '__sm_level' + (level - 1) : '__sm_root';
    query.push('OPTIONAL MATCH');
    query.push(start + '-[__sm_r' + level + ':' + rels + ']->(__sm_level' + level + ')');
  }

  var returnVars = ['__sm_root', 'timestamp() as __sm_ts'];
  for (var level = 0; level < opts.depth; ++level) {
    returnVars.push('COLLECT( __sm_level' + level + ' ) as __sm_level' + level);
    returnVars.push('COLLECT( DISTINCT __sm_r' + level + ' ) as __sm_r' + level);
  }

  query.push("RETURN " + returnVars.join(','));

  if (opts.filter) query.push(opts.filter);

  return query.join(' ');
}

function coalesceAndCompute(data, opts, callback) {
  var self = this;
  async.map(data, function(data, callback) {
    var node = data.__sm_root;

    async.forEach(_.range(opts.depth -1, -1, -1), function(level, callback) {
      var startNodes = data['__sm_level' + (level - 1)] || [node];
      var endNodes = data['__sm_level' + level];
    
      var rels = data['__sm_r' + level];
      
      async.forEach(rels, function(rel, callback) {
        var start = _.find(startNodes, function(node) {
          return node[self.db.options.id] == rel.start;
        });
        var end = _.find(endNodes, function(node) {
          return node[self.db.options.id] == rel.end;
        });

        var comp = opts.compMapping[level][rel.type];
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
        if (Array.isArray(opts.otherVars)) 
          node = _.extend(node, _.pick(data, opts.otherVars));
        if (opts.restrictToComp && !Array.isArray(opts.restrictToComp))
          callback(null, node[opts.restrictToComp]);
        else
          self.compute(node, callback);
      }
    });
  }, function(err, data) {
    if (err) return callback(err);
    callback(null, opts.rootId == null ? data : data[0]);
  });
}

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

    if (typeof opts == 'number') opts = { depth: opts };
    
    opts.rootId = node == null ? null : this.db._getId(node);
    
    var query = assembleReadQuery.call(this, opts);

    this.db.query(query, opts.params, function(err, data) {
      if (err) {
        if (err.neo4jException == 'EntityNotFoundException') callback(null, false);
        else callback(err);
        return;
      };
      if (data.__sm_ts) return self.compute(data.__sm_root, callback);
      if (!data.length) return callback(null, opts.rootId == null ? [] : false);

      coalesceAndCompute.call(self, data, opts, callback);
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
