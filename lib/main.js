var crypto = require('crypto'),
	express = require('express'),
	_ = require('underscore');

function ShopifyAuth() {
	this.options = {
		/*Required by the module:
		api_key: 			'api-key-here',
		api_secret: 	'api-secret',
		scopes: 			'scopes',
		redirect_uri: 'url to redirect to after'

		*/

		/*Optional settings
		verbose: 			true, 
		install_mount_path: '/auth-test'

		*/

		//Default options go here
		embedded_app: 		false,
		verbose: 					false,
		mounted: 					false,
		install_route: 		''
	};	
};

//
// Options
//
ShopifyAuth.prototype.setOptions = function(options){
	if (typeof options === 'object') {
		this.options = _.extend(this.options, options);
	} else {
		this.log('setOptions: New options type is invalid. Expecting OBJECT, got ' + typeof options);
	}
};
ShopifyAuth.prototype.getOption = function(option) {
	//Return the value for this key
	if (option in this.options) {
		return this.options[option];
	} else {
		this.log('No option found for requested key: ' + option);
		return null;
	}
};


ShopifyAuth.prototype.formatShop = function(shop){
	var subdomain_regex = /(?:http[s]*\:\/\/)*(.*?)\.(?=[^\/]*\..{2,5})/i  //javascript

	this.log('formatShop: Testing Shop: ' + shop);

	if (subdomain_regex.test(shop)){
		//Subdomain available, return it
		this.log('formatShop: Shop matched regex: ' + subdomain_regex.exec(shop));
		return subdomain_regex.exec(shop)[1];
	} else {
		return shop;
	}
};


//
//Mount Authentication Routes
//
ShopifyAuth.prototype.mount = function(options){
	var self = this;

	//Requires: express

	//See if we've already mounted
	if (ShopifyAuth.mounted) {
		self.log('Install routes already mounted, cannot mount again');
		//return new Error('Already Mounted');
		throw new Error('Already Mounted');
	}

	var routes = express.Router();

	//Set the default mount paths.
	options = _.extend({
		install_route: '/install',
		complete_route: '/complete'
	}, options);

	//Base route for starting the authentication
	routes.get(options.install_route, function(req, res){ ////------------------------------- BEGIN INSTALL ROUTE HANDLER
		//Verify that we have all of our config settings
		// api_key, scope required

		if (!self.getOption('api_key')) 			throw new Error('API_KEY Not Specified');
		if (!self.getOption('scopes')) 				throw new Error('SCOPES Not Specified');
		if (!self.getOption('redirect_uri')) 	throw new Error('REDIRECT_URI Not Specified');

		//Locate the current SHOP
		//If there is no shop in the current query, then check the last url in our session
		var shop;

		if (req.query.shop) {
			shop = req.query.shop;
		} else {
			//See if we have a session var to use
			if (req.session && req.session._shopify_auth && req.session._shopify_auth.last_url) {
				var shop_regex = /\?(?:.*?)shop=(.*?)(?:&|$)/i
				if (shop_regex.test(req.session._shopify_auth.last_url)) {
					shop = shop_regex.exec(req.session._shopify_auth.last_url)[1];
				}
			}
		}

		//If we still dont have a shop here, then we cannot continue
		if (!shop) throw new Error('SHOP Not Specified');

		shop = self.formatShop(shop);

		//Get our installation URL
		var redirect_url = 'https://{shop}.myshopify.com/admin/oauth/authorize?client_id={api_key}&scope={scopes}&redirect_uri={redirect}';
		redirect_url = redirect_url.replace('{shop}', shop).
															 	replace('{api_key}', self.getOption('api_key')).
																replace('{scopes}', self.getOption('scopes')).
																replace('{redirect}', self.getOption('redirect_uri'));

		self.log('Install URL: ' + redirect_url);

		if (self.getOption('embedded')) {
			//Use an HTML+JS redirect
			res.type('html').send("<html><head></head><body><script type='text/javascript'>window.top.location.href = '" + redirect_url + "';</script></body></html>");
		} else {
			res.redirect(redirect_url);
		}

	}); ////----------------------------------------------------------------------------------- END INSTALL ROUTE HANDLER


	// 																											////----------------------------- BEGIN COMPLETE ROUTE HANDLER
	//The complete route includes an HMAC that must be valid
	routes.get(options.complete_route, self.verifyHMAC({allow_no_hmac: false}), function(req, res){
		var self = this;

		//Shopify has authenticated and called us back with a temporary token. We will call them back to exchange it for
		// a permanent token

		self.post('/admin/oauth/access_token', {
			client_id: self.getOption('api_key'),
			client_secret: self.getOption('api_secret'),
			code: req.query.code
		}, function(err, body){

			//Code exchanged successfully.
			var access_token = body['access_token'];

			//Save access token in the session
			if (!req.session._shopify_auth) req.session._shopify_auth = {}
 			req.session._shopify_auth = _.extend(req.session._shopify_auth, {
				shop: 				req.query.shop,
				access_token: access_token
			});

			self.setOptions({shop: req.query.shop, access_token: access_token});

			//Call the complete callback to let the user finish this flow
			optoins.complete_callback(req, res);

		});

	}); ////---------------------------------------------------------------------------------- END COMPLETE ROUTE HANDLER

	//Indicate that we have already mounted the auth routes
	self.setOptions({mounted: true, install_route: options.install_route});

	self.log('Mount called - new router returned');

	return routes;
};

//
//Full Authentication Route
//

/*

This will ensure that we have an authenticated session tokens, as well as attach various fields
to the request object and response object

options:
	install_mount_path: '/auth'				-- mount path of the ShopifyAuth.mount() middleware

	failed_redirect:  								-- If we are not authenticated, redirect to this location
	
	** if ShopifyAuth.mount() is not used, and failed_redirect is not set, we will reject the transaction with a 401


*/
ShopifyAuth.prototype.authenticate = function(options) {
	var self = this;

	if (typeof options != 'object') {
		self.log('authenticate: No options provided');
		options = {}
	}
	self.log('authenticate: Returning authentication middleware with options: ' + JSON.stringify(options));

	return function authenticate(req, res, next){
		
		//See if our session variables are present
		if (!req.session) return next(new Error('req.session missing'));

		//Check the session for our variables. We are expecting an object with two
		// keys, something like this: req.session._shopify_auth = {shop: 'shop', token: 'token'}
		if (req.session._shopify_auth && 'shop' in req.session._shopify_auth && 'access_token' in req.session._shopify_auth) {

			//shop and token found in the _shopify_auth

			self.log('Authenticated Request. Auth Data: ' + JSON.stringify(req.session._shopify_auth));

			//Add some more data to our options
			self.setOptions({authenticated: true, shop: req.session._shopify_auth.shop, access_token: req.session._shopify_auth.access_token});

			//Resume the flow
			return next();

		} else {

			//No session data. We need to redirect to the authentication route
			self.log('No Session Data Found - Redirecting Or Rejecting');

			//Save the url we tried to go to in our session
			if (!req.session._shopify_auth) req.session._shopify_auth = {}
			req.session._shopify_auth.last_url = req.originalUrl;

			if ('failed_redirect' in options) {
				
				return res.redirect(options.failed_redirect);

			} else if (self.getOption('mounted')) {
			
				if (self.getOption('install_mount_path')) {
					return res.redirect(self.getOption('install_mount_path') + self.getOption('install_route'));
				} else {
					return res.redirect(self.getOption('install_route'));
				}

			} else {
				
				self.log('Not Authenticated - mount() not called, failed_redirect not specified');
				return res.sendStatus(401);

			}

		}

	};
};


//
//HMAC Authentication
//
// Shopify's HMAC codes currently come in two flavours, one for webhooks, and another for
//  regular Admin calls (normal, embedded and POS calls)
// 
// If you know which one you are expecting you can attach the specific middleware, otherwise
//  attach the 'verifyHMAC' middleware, and it will detect which auth should be used and 
//  redirect the verification accordingly

ShopifyAuth.prototype.verifyHMAC = function(options) {
	var self = this;
	//options:
	//	allow_no_hmac: {true, false} [true]
	//			true: if no HMAC is found, we will allow the transaction to continue
	//			false: if no HMAC is found, stop the transaction
	//
	//	no_hmac_callback: {function} []
	//			if allow_no_hmac == false, and no HMAC is found, we will call this function
	//			[default action, return response with 401 Unauthorized]
	//
	return function verifyHMAC(req, res, next){
		//Shopify HMAC shows up in one of two ways:
		//	1. a query param called 'hmac'
		//	2. a request header called 'x-shopify-hmac-sha256'

		if (typeof req.query == 'object' && 'hmac' in req.query) {
			//hmac query found, use the Admin HMAC
			return self.verifyAdminHMAC(req, res, next);
		}

		if (req.headers.hasOwnProperty('x-shopify-hmac-sha256')) {
			//hmac header
			return self.verifyWebhookHMAC(req, res, next);
		}

		//No HMAC was found to verify. See if we should reject the call or not
		if ('allow_no_hmac' in options && options.allow_no_hmac == false) {

			//Reject this transaction. Check to see if we should call a user-defined callback
			if ('no_hmac_callback' in options && typeof options.no_hmac_callback == 'function') {
				//Call the user callback
				return options.no_hmac_callback();
			} else {
				return res.sendStatus(401);
			}

		} else {
			//option not specified, or set to true
			self.log('verifyHMAC: No HMAC to verify. Resuming call chain');
			return next();			
		}

	};
};

ShopifyAuth.prototype.verifyWebhookHMAC = function(req, res, next){
	//Webhook's are verified with HMAC

	var hmac = req.headers['x-shopify-hmac-sha256'],
	  kvpairs = [],
	  message,
	  digest;

	message = JSON.stringify(req.body);

	//Shopify seems to be escaping forward slashes when the build the HMAC
	// so we need to do the same otherwise it will fail validation

	//message = message.replace('/', '\\/');
	message = message.split('/').join('\\/');

	digest = crypto.createHmac('SHA256', this.getOption('api_secret')).update(message).digest('base64');

	//console.log('HMAC  : ' + hmac);
	//console.log('Digest: ' + digest);

	if (digest === hmac) {
	  req._hmac_verified = true;
	  next();
	} else {
	  //console.error('Webhook HMAC Failed');
	  //res.status(401).send('failed webhook hmac validation');
    this.logError('Failed HMAC Verification (Webhook)');
	  return res.sendStatus(401);
	}
};

ShopifyAuth.prototype.verifyAdminHMAC = function(req, res, next){
	//Admin requests are signed with an hmac
  var params = req.query;

 	var hmac = params['hmac'],
    kvpairs = [],
    message,
    digest;

  //Build the remaining values into a new query string
  //TODO - The replace below will only get the 1st occurance - replace with split/join
  for (var key in params) {
    if (key != "hmac" && key != "signature") {
      kvpairs.push(
        key.replace(['%', '&', '='], ['%25', '%26', '%3D']) 
        + '=' 
        + params[key].replace(['%', '&', '='], ['%25', '%26', '%3D'])
      );
    }
  }

  message = kvpairs.sort().join('&');

  digest = crypto.createHmac('SHA256', this.getOption('api_secret')).update(message).digest('hex');

  //console.log('HMAC  : ' + hmac);
  //console.log('Digest: ' + digest);

  //return (digest === hmac);
  if (digest === hmac) {
    req._hmac_verified = true;
    next();
  } else {
    //console.error('Application HMAC Failed');
    //res.status(401).send('failed hmac validation');
    this.logError('Failed HMAC Verification (Admin)');
    return res.sendStatus(401);
  }
};


//
//Authenticated Requests
//

// callback signature: err, data, headers
// 
// 

// Supports Shopify's API Rate Limiting
ShopifyAuth.prototype.get = function(endpoint, callback){
	this.request(endpoint, 'GET', null, callback);
};
ShopifyAuth.prototype.post = function(endpoint, data, callback){
	this.request(endpoint, 'POST', data, callback);
};
ShopifyAuth.prototype.delete = function(endpoint, data, callback){
	this.request(endpoint, 'DELETE', data, callback);
};

ShopifyAuth.prototype.request = function(endpoint, method, data, callback){
	var self = this;

	var reqData = JSON.stringify(data);

	//Send an HTTPS request to Shopify to get the data
	var https = require('https'),
		request_options = {
			hostname: self.formatShop(self.getOption('shop')) + '.myshopify.com',
			port: 443,
			method: method.toLowerCase() || 'get',

			path: endpoint,
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			}
		};

	//If we have an access token, we will provide it as well as a header
	if (self.getOption('access_token')) {
		request_options.headers['X-Shopify-Access-Token'] = self.getOption('access_token');
	}

	//If we are sending data, we need to include how long the data is
	if (_.contains(['post', 'put', 'delete'], request_options.method)) {
		request_options.headers['Content-Length'] = new Buffer(reqData).length;
	}

	var request = https.request(request_options, function(response){
		self.log('request > Status : ' + response.statusCode);
		self.log('request > Headers: ' + JSON.stringify(response.headers));
		self.log('request > RateLim: ' + response.headers['X-Shopify-Shop-Api-Call-Limit'] || 'No Rate Limiting Header');

		response.setEncoding('utf8');

		//Read the data from the body and save it
		var resBody = '';

		response.on('data', function(dataPart){ 
			resBody += dataPart; 
		});

		response.on('end', function() {

			//todo
			// Support automatic rate-limiting

			//Package up the response, and call the callback
			var json = {}, err;

			if (resBody.trim() != '') json = JSON.parse(resBody);
			if (json.hasOwnProperty('error') || json.hasOwnProperty('errors')) {
				err = {
					code: response.statusCode,
					error: json.error || json.errors
				}
			}

			callback(err, json, response.headers);

		});

	});

	//Handle request errors
	request.on('error', function(err){
		self.log('request > Error: ' + err);
		return callback(err, null);
	});

	//Write the data to the request if needed
	if (_.contains(['post', 'put', 'delete'], request_options.method)) {
		request.write(reqData);
	}

	//Complete our processing of the request
	request.end();

};



//
//INTERNAL SUPPORT METHODS
//
ShopifyAuth.prototype.logError = function(message) {
	this._log(message, 'e');
};
ShopifyAuth.prototype.log = function(message){
	this._log(message, 'i');
};
ShopifyAuth.prototype._log = function(message, type){
	if (this.getOption('verbose')) {
		if (!type) type = 'i';
		if (type == 'e') {
			//console.error(message);
			console.error('[node-shopify-auth] (' + type + '): ' + message || '');
		} else {
			//console.log(message);
			console.log('[node-shopify-auth] (' + type + '): ' + message || '');
		}
	}
};

//module.exports = ShopifyAuth;
module.exports = exports = new ShopifyAuth();