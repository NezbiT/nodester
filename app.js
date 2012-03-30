#!/usr/bin/env node

/*
 * Nodester opensource Node.js hosting service
 * Written by: @ChrisMatthieu & @DanBUK
 * Mainteiner: Alejandro Morales (@_alejandromg)
 * http://nodester.com
 * http://github.com/nodester
*/


var express = require('express')
  , url     = require('url')
  , sys     = require('util')
  , path    = require('path')
  , config  = require('./config')
  , middle  = require('./lib/middle')
  , stats   = require('./lib/stats')
  ;

var app = express.createServer();

app.configure(function () {
  app.use(express.bodyParser());
  app.use(express.static(config.opt.public_html_dir));
  app.use(express.errorHandler({
    showStack: true,
    dumpExceptions: true
  }));
});


// Error handler
app.error(function (err, req, res, next) {
  if (err instanceof NotFound) {
    console.log(NotFound)
    res.sendfile(__dirname + '/public/404.html');
  } else {
    res.sendfile(__dirname + '/public/500.html');
  }
});


/*
 * status emitter
*/

var bolt = require('bolt');

var dash = new bolt.Node({
    delimiter : '::',
    host      : config.opt.redis.host,
    port      : config.opt.redis.port,
    user      : config.opt.redis.user,
    auth      : config.opt.redis.auth,
    silent    : true
});

dash.start();

app.all('*',function(req,res,next){
  if (!path.extname(req.url)){
    var ip = req.connection.remoteAddress || req.socket.remoteAddress;
    if (req.headers["x-real-ip"]) ip =req.headers["x-real-ip"];
    var toEmit = {
      ip     : ip,
      url    : req.url,
      time   : new Date,
      method : req.method,
      ua     : req.headers['user-agent'] || 'nodester',
      host   : req.headers.host
    }
    dash.emit('nodester::incomingRequest', toEmit);
  }
  next();
})

function getStats(){
  var statistics ={}
  for (var stat in stats){
    if (stat != 'getDiskUsage' && stat != 'getProcesses'){
      statistics[stat]  = stats[stat]()
    } else {
      stats[stat](function(error,resp){
        if (!error)
          statistics[stat] = resp;
        else 
          statistics[stat] = '0'
      });
    }
  }
  return statistics;
}

/*
 * Ping every 3 seconds
*/
setInterval(function(){
  dash.emit('nodester::ping',{date:new Date})
},3000);

/*
 * emit stats every 5 seconds
*/

setInterval(function(){
  dash.emit('nodester::stats',getStats())
}, 5000);


process.on('uncaughtException', function (err) {
  dash.emit('nodester::uE', err);
  console.log(err.stack);
});

/* Routes  */

// Homepage
app.get('/', function (req, res, next) {
  res.sendfile(__dirname +'/public/index.html');
});

app.get('/api', function (req, res, next) {
  res.sendfile(__dirname +'/public/api.html');
});
app.get('/help', function (req, res, next) {
  res.sendfile(__dirname +'/public/help.html');
});
app.get('/about', function (req, res, next) {
  res.sendfile(__dirname +'/public/about.html');
});

app.get('/admin', function (req, res, next) {
  res.redirect('http://admin.nodester.com');
});

app.get('/irc', function (req, res, next) {
  res.redirect('http://irc.nodester.com');
});

app.get('/monitor', function (req, res, next) {
  res.redirect('http://site.nodester.com');
});

/* Status API */
// http://localhost:4001/status
// curl http://localhost:4001/status
var status = require('./lib/status');

app.get('/status', status.get);

// New coupon request
// curl -X POST -d "email=dan@nodester.com" http://localhost:4001/coupon
var coupon = require('./lib/coupon');

app.post('/coupon', coupon.post);

// curl http://localhost:4001/unsent
app.get('/unsent', coupon.unsent);


// New user account registration
// curl -X POST -d "user=testuser&password=123&email=chris@nodefu.com&coupon=hiyah" http://localhost:4001/user
// curl -X POST -d "user=me&password=123&coupon=hiyah" http://localhost:4001/user
var user = require('./lib/user');
app.post('/user', user.post);

// localhost requires basic auth to access this section
// Edit your user account
// curl -X PUT -u "testuser:123" -d "password=test&rsakey=1234567" http://localhost:4001/user
app.put('/user', middle.authenticate, user.put);

// Delete your user account
// curl -X DELETE -u "testuser:123" http://localhost:4001/user
app.del('/user', middle.authenticate, user.delete);

// All Applications info
// http://chris:123@localhost:4001/apps
// curl -u "testuser:123" http://localhost:4001/apps
var apps = require('./lib/apps');

app.get('/apps', middle.authenticate, apps.get);


var app = require('./lib/app');

// Application info
// http://chris:123@localhost:4001/apps/<appname>
// curl -u "testuser:123" http://localhost:4001/apps/<appname>
app.get('/apps/:appname', middle.authenticate, middle.authenticate_app, app.get);
app.get('/app/:appname', middle.deprecated, middle.authenticate, middle.authenticate_app, app.get); // deprecated

// Create node app
// curl -X POST -u "testuser:123" -d "appname=test&start=hello.js" http://localhost:4001/apps
app.post('/apps/:appname', middle.authenticate, app.post);
app.post('/apps', middle.authenticate, app.post);
app.post('/app', middle.deprecated, middle.authenticate, app.post); // deprecated

// App backend restart handler
app.get('/app_restart', app.app_restart);
app.get('/app_start', app.app_start);
app.get('/app_stop', app.app_stop);

// Update node app
// start=hello.js - To update the initial run script
// running=true - To Start the app
// running=false - To Stop the app
// curl -X PUT -u "testuser:123" -d "start=hello.js" http://localhost:4001/apps/test
// curl -X PUT -u "testuser:123" -d "running=true" http://localhost:4001/apps/test
// curl -X PUT -u "testuser:123" -d "running=false" http://localhost:4001/apps/test
// curl -X PUT -u "testuser:123" -d "running=restart" http://localhost:4001/apps/test
// TODO - Fix this function, it's not doing callbacking properly so will return JSON in the wrong state!
app.put('/apps/:appname', middle.authenticate, middle.authenticate_app, app.put);
app.put('/app', middle.deprecated, middle.authenticate, middle.authenticate_app, app.put); // deprecated
app.put('/app/audit', middle.authenticate_admin,app.audit);
app.put('/app/restart/:appname', middle.authenticate_admin,app.restartByName);
// Delete your nodejs app
// curl -X DELETE -u "testuser:123" -d http://localhost:4001/apps/test
app.del('/apps/:appname', middle.authenticate, middle.authenticate_app, app.delete);
app.del('/app/:appname', middle.deprecated, middle.authenticate, middle.authenticate_app, app.delete); // deprecated

app.del('/gitreset/:appname', middle.authenticate, middle.authenticate_app, app.gitreset);

// curl -u "testuser:123" -d "appname=test" http://localhost:4001/applogs
app.get('/applogs/:appname', middle.authenticate, middle.authenticate_app, app.logs);

// Retrieve information about or update a node app's ENV variables
// This fulfills all four RESTful verbs.
// GET will retrieve the list of all keys.
// PUT will either create or update.
// DELETE will delete the key if it exists.
// curl -u GET -u "testuser:123" -d "appname=test" http://localhost:4001/env
// curl -u PUT -u "testuser:123" -d "appname=test&key=NODE_ENV&value=production" http://localhost:4001/env
// curl -u DELETE -u "testuser:123" -d "appname=test&key=NODE_ENV" http://localhost:4001/env

// Get info about available versions.
// curl -XGET http://localhost:4001/env/version
app.get('/env/version', app.env_version);
// Get info about a specific version and see if it's installed
// without need of basic auth
// curl -XGET http://localhost:4001/env/:version
app.get('/env/version/:version', app.check_env_version);
app.get('/env/:appname', middle.authenticate, middle.authenticate_app, app.env_get);
app.put('/env', middle.authenticate, middle.authenticate_app, app.env_put);
app.del('/env/:appname/:key', middle.authenticate, middle.authenticate_app, app.env_delete);

// APP NPM Handlers
var npm = require('./lib/npm');
// curl -X POST -u "testuser:123" -d "appname=test&package=express" http://localhost:4001/appnpm
// curl -X POST -u "testuser:123" -d "appname=test&package=express" http://localhost:4001/npm
// curl -X POST -u "testuser:123" -d "appname=test&package=express,express-extras,foo" http://localhost:4001/npm
app.post('/appnpm', middle.authenticate, middle.authenticate_app, npm.post);
app.post('/npm', middle.authenticate, middle.authenticate_app, npm.post);

// curl -X POST -u "testuser:123" -d "appname=test&domain=<domainname>" http://localhost:4001/appdomains
// curl -X DELETE -u "testuser:123" -d "appname=test&domain=<domainname>" http://localhost:4001/appdomains
var domains = require('./lib/domains');
app.post('/appdomains', middle.authenticate, middle.authenticate_app, domains.post);
app.del('/appdomains/:appname/:domain', middle.authenticate, middle.authenticate_app, domains.delete);
app.get('/appdomains', middle.authenticate, domains.get);

// curl -X POST -d "user=username" http://localhost:4001/reset_password
// curl -X PUT -d "password=newpassword" http://localhost:4001/reset_password/<token>
var reset_password = require('./lib/reset_password');
app.post('/reset_password', reset_password.post);
app.put('/reset_password/:token', reset_password.put);



app.listen(4001);
console.log('Nodester app started on port 4001');

//The 404 Route (ALWAYS Keep this as the last route)
app.get('/*', function (req, res) {
  throw new NotFound;
});

function NotFound(msg) {
  this.name = 'NotFound';
  Error.call(this, msg);
  Error.captureStackTrace(this, arguments.callee);
};
