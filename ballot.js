var express = require('express');
var cookie_parser = require('cookie-parser');
var app = express();
var auth = require('basic-auth');

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
					'count': c,
					'oo': oo
				});
			}
			res.send('vote cast');
		} else {
			res.status(400).send('invalid');
		}
	} else {
		res.status(400).send('closed');
	}

	console.log(token + ' votes for ' + x);
	console.log(ballot.size);
});

app.post('/init/:num', function(req, res) {
	ballot_length = parseInt(req.params.num);
	if (isNaN(ballot_length) || Math.floor(ballot_length) !== ballot_length) {
		res.status(400).send('Invalid request');
		return;
	}
	init = true;
	open = true;
	ballot = {};
	console.log('Ballot with ' + ballot_length + ' candidates initialized.')
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
	if (!credentials || credentials.name !== 'funny' || credentials.pass !== 'ducks') {
		res.statusCode = 401
		res.setHeader('WWW-Authenticate', 'Basic realm="example"')
		res.end('Access denied')} else {
	open = false;
	for (var i = 0; i < sockets.length; i++) {
		sockets[i].emit('ballot_end', {});
	}
	res.json(ballot);
	console.log('Ballot closed.');
	}
});


var server = require("http").createServer(app);
var io = require('socket.io')(server);
io.on('connection', function(socket) {
	sockets.push(socket);
	console.log('sock');
});

server.listen(3000);
