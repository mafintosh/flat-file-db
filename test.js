var test = require('tap').test;
var fs = require('fs');
var ff = require('./index');
var os = require('os');
var path = require('path');

var reset = function(file) {
	try {
		fs.unlinkSync(file);
	} catch (err) {}
	return file;
};

var TMP = path.join(os.tmpDir(), 'test1.db');

test('freelist', function(t) {

	// make sure it's the same as in index.js
	var BLOCK_SIZE = 256;

	// make sure this function is the same as in index.js
	var nextBlockSize = function(length) {
		var i = 0;
		while ((BLOCK_SIZE << i) < length) i++;
		return i;
	};

	var len = 1000;

	var db = ff.sync(reset(TMP));

	while (nextBlockSize(len) < db._freelists.length) {
		len *= 2;
	}

	var data = '';
	for (var i=0; i<len; i++) {
		data += 'a';
	}

	data = {d:data};

	db.put('a', data);
	db.put('b', data);

	db.put('a', data);

	db.del('b');

	// there was also a bug on re-loading freelists
	// for large block sizes, so let's read the DB back
	db.on('drain', function(){
		ff.sync(TMP);
		t.end();
	});


});

test('open + write + get', function(t) {
	t.plan(2);

	var db = ff.sync(reset(TMP));

	db.put('hello', 'world');
	t.same(db.get('hello'), 'world');
	db.put('hello-2', 'world-2', function(err) {
		if (err) throw err;
		var db2 = ff.sync(TMP);
		t.same(db2.get('hello-2'), 'world-2');
	});
});

test('del', function(t) {
	t.plan(5);

	var db = ff.sync(reset(TMP));

	db.put('hello', 'world', function(err) {
		if (err) throw err;
		t.same(db.get('hello'), 'world');
		db.del('hello', function(err) {
			if (err) throw err;
			var db2 = ff.sync(TMP);
			t.same(db2.get('hello'), undefined);
			t.same(db2.keys().length, 0);
		});
		t.same(db.get('hello'), undefined);
		t.same(db.keys().length, 0);
	});
});

test('multiple writes', function(t) {
	t.plan(20);

	var db = ff.sync(reset(TMP));

	for (var i = 0; i < 20; i++) {
		db.put('hello-'+i, 'world-'+i);
	}

	db.on('drain', function() {
		var db2 = ff.sync(TMP);

		for (var i = 0; i < 20; i++) {
			t.same(db2.get('hello-'+i), 'world-'+i);
		}
	});
});

test('last write wins', function(t) {
	t.plan(1);

	var db = ff.sync(reset(TMP));

	for (var i = 0; i < 20; i++) {
		db.put('count', {count:i});
	}

	db.on('drain', function() {
		var db2 = ff.sync(TMP);
		t.same(db2.get('count'), {count:19});
	});
});

test('big write', function(t) {
	t.plan(3);

	var db = ff.sync(reset(TMP));
	var doc = {data:'data'};

	db.put('test', doc, function(err) {
		t.ok(!err, 'write should not fail');
		doc.data = new Buffer(512).toString('hex');
		db.put('test', doc, function(err) {
			t.ok(!err, 'write should not fail');
			var db2 = ff.sync(TMP);
			t.same(db.get('test'), doc);
		});
	});
});
