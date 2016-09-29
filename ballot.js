var express = require('express');
var cookie_parser = require('cookie-parser');
var app = express();
var auth = require('basic-auth');

var fs = require('fs');
var configuration = {};
try {
	configuration = JSON.parse(fs.readFileSync('config.json'));
} catch (err) {
	console.log('Configuration file cannot be read.');
}

var init = false;
var open = false;

var ballot = {};
var ballot_length = 0;
var sockets = [];
var tokens = 0;

function guid() {
	function s4() {
		return Math.floor((1 + Math.random()) * 0x10000)
			.toString(16)
			.substring(1);
	}
	return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
		s4() + '-' + s4() + s4() + s4();
}

function count() {
	return Object.keys(ballot).length;
}

function authenticated(req, res) {
	var credentials = auth(req);
	if (!credentials || credentials.name !== configuration.credentials.username || credentials.pass !== configuration.credentials.password) {
		res.statusCode = 401;
		res.setHeader('WWW-Authenticate', 'Basic realm="ballot"');
		res.end('Access denied');
		console.log('Blocked unauthenticated request.');
		return false;
	} else {
		return true;
	}
}

// need cookieParser middleware before we can do anything with cookies
app.use(cookie_parser());

// set a cookie
app.use(function(req, res, next) {
	if (!("token" in req.cookies)) {
		res.cookie('token', guid(), {
			maxAge: 900000,
			httpOnly: true
		});
	}
	next();
});

app.use(express.static('public'));

app.get('/master', function(req, res) {
	if (authenticated(req, res)) {
		res.sendFile('master.html', {root: __dirname});
	}
});

app.get('/url', function(req, res) {
	var fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
	console.log(fullUrl);
	res.send(fullUrl);
});

app.post('/vote/:x', function(req, res) {
	var token = req.cookies["token"];
	if (token === undefined) {
		res.status(400).send("A token is required to vote.");
		return;
	}

	if (open) {
		var x = req.params.x;
		if (x >= 0 && x < ballot_length) {
			ballot[token] = x;
			var c = count();
			var oo = sockets.length;
			for (var i = 0; i < sockets.length; i++) {
				sockets[i].emit('count', {
					'count': c
				});
			}
			res.status(204).send();
		} else {
			res.status(400).send('invalid');
		}
	} else {
		res.status(400).send('closed');
	}
});

app.post('/init/:num', function(req, res) {
	if (authenticated(req, res)) {
		ballot_length = parseInt(req.params.num);
		if (isNaN(ballot_length) || Math.floor(ballot_length) !== ballot_length) {
			res.status(400).send('Invalid request');
			return;
		}
		init = true;
		open = true;
		ballot = {};
		for (var i = 0; i < sockets.length; i++) {
			sockets[i].emit('ballot_init', ballot_length);
		}
		console.log('Ballot with ' + ballot_length + ' candidates initialized.')
	}
});

app.get('/num', function(req, res) {
	res.json(ballot_length);
});

app.get('/result', function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	var result = Array.apply(null, Array(ballot_length)).map(Number.prototype.valueOf, 0);
	for (var k in ballot) {
		result[ballot[k]]++;
	}
	res.json(result);
});

app.post('/close', function(req, res) {
	var credentials = auth(req);
	if (!credentials || credentials.name !== configuration.credentials.username || credentials.pass !== configuration.credentials.password) {
		res.statusCode = 401
		res.setHeader('WWW-Authenticate', 'Basic realm="ballot"')
		res.end('Access denied')} else {
	open = false;
	for (var i = 0; i < sockets.length; i++) {
		sockets[i].emit('ballot_end', {});
	}
	console.log('Ballot closed.');
	}
});

app.post('/open', function(req, res) {
	var credentials = auth(req);
	if (!credentials || credentials.name !== configuration.credentials.username || credentials.pass !== configuration.credentials.password) {
		res.statusCode = 401
		res.setHeader('WWW-Authenticate', 'Basic realm="ballot"')
		res.end('Access denied')} else {
	open = false;
	for (var i = 0; i < sockets.length; i++) {
		sockets[i].emit('ballot_open', {});
	}
	console.log('Ballot (re)opened.');
	}
});

var server = require("http").createServer(app);
var io = require('socket.io')(server);
io.on('connection', function(socket) {
	sockets.push(socket);
	socket.on('disconnect', function() {
		var i = sockets.indexOf(socket);
		sockets.splice(i, 1);
	});
});

server.listen(configuration.server.port);
