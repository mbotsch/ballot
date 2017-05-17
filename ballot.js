var express = require('express');
var cookie_parser = require('cookie-parser');
var app = express();
var auth = require('basic-auth');
var request = require('request');

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
		res.sendFile('master.html', {
			root: __dirname
		});
	}
});

app.get('/url', function(req, res) {
	var fullUrl = req.protocol + '://' + req.get('host');
	if (configuration.google.key == "") {
		var answer = {
			longUrl: fullUrl
		};
		res.send(answer);
	} else {
		var data = {
			uri: 'https://www.googleapis.com/urlshortener/v1/url?key=' + configuration.google.key,
			body: {
				longUrl: fullUrl
			},
			json: true
		};
		request.post(data, function(error, response, body) {
			if (!error && response.statusCode == 200) {
				var answer = {
					shortUrl: body.id,
					longUrl: body.longUrl
				};
				res.send(answer);
			} else {
				console.log(error);
				console.log(response);
				var answer = {
					longUrl: fullUrl
				};
				res.send(answer);
			}
		})
	}
});

app.post('/vote/:x', function(req, res) {
	// Fail if the vote comes without a token.
	var token = req.cookies["token"];
	if (token === undefined) {
		res.status(400).send("A token is required to vote.");
		return;
	}

	// Fail if the vote is invalid.
	var x = req.params.x;
	if (isNaN(x) || Math.floor(x) != x || x < 0 || x >= ballot_length) {
		res.status(400).send('Invalid vote.');
		return;
	}

	// Fail if there is no open ballot.
	if (!init || !open) {
		res.status(400).send('No open ballot.');
		return;
	}

	// If all is good, cast the vote.
	ballot[token] = x;

	// Notify sockets of (possibly changed) number of votes cast.
	var c = count();
	var oo = sockets.length;
	for (var i = 0; i < sockets.length; i++) {
		sockets[i].emit('count', {
			'count': c
		});
	}

	// All good.
	res.status(204).send();
});

app.post('/init/:num', function(req, res) {
	if (authenticated(req, res)) {
		ballot_length = parseInt(req.params.num);
		if (isNaN(ballot_length) || Math.floor(ballot_length) != ballot_length) {
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
		res.status(204).send();
	}
});

app.get('/num', function(req, res) {
	res.json(ballot_length);
});

app.get('/result', function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	var result = Array.apply(null, Array(ballot_length)).map(Number.prototype.valueOf, 0);
	var num_voters = 0;
	for (var voter in ballot) {
		vote = ballot[voter];
		for (var i = 0; i < vote.length; i++) {
			result[vote[i]]++;
		}
		num_voters++;
	}
	for (var i = 0; i < result.length; i++) {
		result[i] = result[i] / num_voters * 100;
	}
	res.json(result);
});

app.post('/close', function(req, res) {
	if (authenticated(req, res)) {
		if (init && open) {
			open = false;
			for (var i = 0; i < sockets.length; i++) {
				sockets[i].emit('ballot_end', {});
			}
			console.log('Ballot closed.');
			res.status(204).send();
		} else {
			res.status(400).send('Already closed or not initialized.');
		}
	}
});

app.post('/open', function(req, res) {
	if (authenticated(req, res)) {
		if (init && !open) {
			open = true;
			for (var i = 0; i < sockets.length; i++) {
				sockets[i].emit('ballot_open', {});
			}
			console.log('Ballot (re)opened.');
			res.status(204).send();
		} else {
			res.status(400).send('Already open or not initialized.');
		}
	}
});

app.get('/status', function(req, res) {
	if (init) {
		if (open) {
			res.json('open');
		} else {
			res.json('closed');
		}
	} else {
		res.json('not_init');
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
	socket.on('vote', function(vote) {
		ballot[socket.id] = vote;
	});
});

server.listen(configuration.server.port);
