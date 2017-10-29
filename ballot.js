var express = require('express');
var app = express();
var auth = require('basic-auth');
var request = require('request');
var server = require("http").createServer(app);
var io = require('socket.io')(server);
var fs = require('fs');


// read configuration from file
var configuration = {};
try {
	configuration = JSON.parse(fs.readFileSync('config.json'));
} catch (err) {
	console.log('Configuration file cannot be read.');
}


var init = false;       // has ballot been initialized?
var open = false;       // is a ballot open?
var ballot = {};        // given votes
var ballot_length = 0;  // number of possible answers in current ballot



//--------------------------------------- communication with quiz pariticipants


// whenever a clients connects...
io.on('connection', function(socket) {

    // if ballot is running, let client create buttons
    if (init) {
        socket.emit('ballot_init', ballot_length);
    }

    // store client's vote
	socket.on('vote', function(vote) {
		ballot[socket.id] = vote;
	});
});


// everything in public directory is just served
app.use(express.static('public'));



//--------------------------------------------- communication with quiz admin


// is request authenticated by username and password?
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


// open master view (requires authentication)
app.get('/master', function(req, res) {
	if (authenticated(req, res)) {
		res.sendFile('master.html', {
			root: __dirname
		});
	}
});


// start a ballot with "num" answers
app.post('/init/:num', function(req, res) {

    // enable CORS with authentication
    res.header("Access-Control-Allow-Origin", req.headers.origin);
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST");

    // require authentication
    if (authenticated(req, res))
    {
        // get #answers
        ballot_length = parseInt(req.params.num);
		if (isNaN(ballot_length) || Math.floor(ballot_length) != ballot_length) {
			res.status(400).send('Invalid request');
			return;
		}

        // initialize
		init = true;
		open = true;
		ballot = {};

        // send message to all participants
        io.emit('ballot_init', ballot_length);

        // give feedback
		console.log('Ballot with ' + ballot_length + ' candidates initialized.')
		res.status(204).send();
	}
});


// how many answers in current ballot?
app.get('/num', function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	res.json(ballot_length);
});


// how many votes have been entered already?
app.get('/count', function(req, res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	res.json(Object.keys(ballot).length + '/' + io.engine.clientsCount);
});


// return voting results
app.get('/result', function(req, res) {

    // setup CORS (no authentication)
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


// close current ballot
app.post('/close', function(req, res) {

    // enable CORS with authentication
    res.header("Access-Control-Allow-Origin", req.headers.origin);
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST");

    // require authentication
	if (authenticated(req, res))
    {
		if (init && open)
        {
			open = false;
            io.emit('ballot_end', {});
			console.log('Ballot closed.');
		}
        res.status(204).send();
	}
});


// return status: ballot is open, closed, or not initialized
app.get('/status', function(req, res) {

    // setup CORS (no authentication)
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

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




// run HTTP server...
server.listen(configuration.server.port);
