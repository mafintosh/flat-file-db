var fs = require('fs');
var events = require('events').EventEmitter();

var BLOCK_SIZE = 256;
var TAB = 9;
var NEWLINE = 10;

var noop = function() {};

var nextBlockSize = function(length) {
	var i = 0;
	while ((BLOCK_SIZE << i) < length) i++;
	return i;
};

var tryParse = function(data) {
	try {
		return JSON.parse(data);
	} catch (err) {
		return null;
	}
};

var max = function(a, b) {
	return a > b ? a : b;
};

var alloc = function(self, block) {
	while (self._freelists.length < block) self._freelists.push([]);

	var freelist = self._freelists[block];

	if (!freelist.length) {
		freelist.push(self._head);
		self._head += BLOCK_SIZE << block;
	}

	return freelist.pop();
};

var parseDatabase = function(self, data) {
	var pointer = -1;
	var entries = [];
	var latest = self._entries;
	var tick = self._tick;

	for (var i = 0; i < data.length; i++) {
		if (data[i] === TAB) {
			pointer = i;
		}
		if (data[i] === NEWLINE) {
			var buf = data.slice(pointer, i);
			var row = tryParse(buf.toString());
			var entry = {pointer:pointer, block:nextBlockSize(buf.length), row:row};
			pointer = -1;
			if (row) entries.push(entry);
		}
	}

	entries.forEach(function(entry) {
		var key = entry.row[1];
		if (entry.row[2] === null || entry.row[2] === undefined) return;
		if (!latest[key] || latest[key].row[0] < entry.row[0]) latest[key] = entry;
		tick = max(tick, entry.row[0]);
	});

	entries = entries.filter(function(entry) {
		return latest[entry.row[1]] === entry;
	});

	self._tick = tick;
	populateFreelist(self, entries);
};

var populateFreelist = function(self, entries) {
	var freelists = self._freelists;

	var free = function(from, to, block) {
		while (freelists.length < block) freelists.push([]);

		var size = BLOCK_SIZE << block;

		while (to - from >= size) {
			freelists[block].push(from);
			from += size;
		}

		return from;
	};

	var maxBlock = entries
		.map(function(entry) {
			return entry.block;
		})
		.reduce(max, 0);

	entries.forEach(function(entry) {
		var from = self._head;
		from = free(from, entry.pointer, maxBlock);
		from = free(from, entry.pointer, 0);
		self._head = entry.pointer + (BLOCK_SIZE << entry.block);
	});
};

var Database = function(path) {
	this.path = path;
	this.fd = 0;

	this._head = 0;
	this._tick = 0;
	this._entries = {};
	this._freelists = [[], [], [], [], [], []];
};

var writefd = function(fd, buf, entry, oldPointer, oldFreelist, cb) {
	fs.write(fd, buf, 0, buf.length, entry.pointer, function(err) {
		if (err) return cb(err);
		if (oldFreelist) oldFreelist.push(oldPointer);
		cb();
	});
};

Database.prototype.put = function(key, val, cb) {
	if (!this.fd) throw new Error('database is not open');

	var entry = this._entries[key];
	var oldFreelist;
	var oldPointer;

	if (entry) {
		oldPointer = entry.pointer;
		oldFreelist = this._freelists[entry.block];
		entry.row[0] = ++this._tick;
	} else {
		entry = this._entries[key] = {pointer:0, block:0, row:[++this._tick, key, val]};
	}

	if (val === undefined) delete this._entries[key];

	var buf = new Buffer('\t'+JSON.stringify(entry.row)+'\n');
	if (buf.length > (BLOCK_SIZE << entry.block)) entry.block = nextBlockSize(buf.length, BLOCK_SIZE);

	entry.pointer = alloc(this, entry.block);
	writefd(this.fd, buf, entry, oldPointer, oldFreelist, cb || noop);
};

Database.prototype.del = function(key, cb) {
	this.put(key, undefined, cb);
};

Database.prototype.get = function(key) {
	if (!this.fd) throw new Error('database is not open');
	var entry = this._entries[key];
	return entry && entry.row[2];
};

Database.prototype.has = function(key) {
	if (!this.fd) throw new Error('database is not open');
	return !!this._entries[key];
};

Database.prototype.keys = function() {
	if (!this.fd) throw new Error('database is not open');
	return Object.keys(this._entries);
};

Database.prototype.close = function() {
	var self = this;
	var fd = this.fd;
	this.fd = 0;
	fs.close(fd, function(err) {
		if (err) return self.emit('error', err);
		self.emit('close');
	});
};

Database.prototype.open = function() {
	var self = this;

	fs.exists(self.path, function(exists) {
		fs.open(self.path, exists ? 'r+' : 'w+', function(err, fd) {
			if (err) return self.emit('error', err);
			fs.readFile(self.path, function(err, buf) {
				if (err) return self.emit('error', err);
				self.fd = fd;
				parseDatabase(self, buf);
				self.emit('open');
			});
		});
	});
};

Database.prototype.openSync = function() {
	this.fd = fs.openSync(this.path, fs.existsSync(this.path) ? 'r+' : 'w+');
	parseDatabase(this, fs.readFileSync(this.path));
};

var open = function(path) {
	var db = new Database(path);
	db.open();
	return db;
};

open.sync = function(path) {
	var db = new Database(path);
	db.openSync();
	return db;
};

module.exports = open;