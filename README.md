node-shopify-auth
=================

[![npm version](https://badge.fury.io/js/node-shopify-auth.svg)](https://badge.fury.io/js/node-shopify-auth)

A Shopify.com OAuth Authentication + API Module for Node.js + Express 4.x

Installing
----------

```
npm install --save node-shopify-auth
```

Requirements
------------

- Node.js
- Express 4.x
- A Session manager, with the session available at `req.session`
- [A Shopify Partner Account](https://www.shopify.com/partners)


## Setup

Include the module in either your main application, or a route module
```js
var ShopifyAuth = require('node-shopify-auth');
```

Set your options. The following is the minimum requirements
```js
ShopifyAuth.setOptions({
  api_key:      'YOUR-SHOPIFY-API-KEY',
  api_secret:   'YOUR-SHOPIFY-SHARED-SECRET',
  scopes:       'YOUR-SHOPIFY-SCOPES',
  redirect_uri: 'YOUR-SHOPIFY-REDIRECT-URI'
});
```

#### Options
Option              | Default       | Description 
:------------------ | :------------ | :------------------------------------------------------
`api_key`           | `(blank)`     | This is the api key from your Shopify Partner Account App
`api_secret`        | `(blank)`     | This is the api secret from your Shopify Partner Account App
`scopes`            | `(blank)`     | This is the comma-separated list of scopes that your app requires. See https://docs.shopify.com/api/authentication/oauth#scopes for more details
`redirect_uri`      | `(blank)`     | This is the uri that Shopify will redirect back to upon completion of the installation process. The URL used here MUST be in the list of redirect URI's that you set in the App settings on Shopify
`verbose`           | `false`       | Enable detailed logging from the module to the console
`embedded`          | `false`       | Set this to True if you are developing an Embedded Shopify App. This will control the install flow to escape the iframe when trying to install the application. See https://docs.shopify.com/embedded-app-sdk for more details
`install_mount_path`| `(blank)`     | If you use the default install flow from the module, this will need to contain the location that you mount the flow to. See  [Mounting the Included Install Flow](#mounting-the-included-install-flow) below for more details


Authentication
--------------

The most common thing you'll want to do is to secure various parts of your application so that they can only be accessed by authenticated Shopify stores, or truly originated from Shopify. This module provides two mechanisms for authenticating access:
- Authentication of application installation
- Authentication of incoming request originated from Shopify

Both mechanisms are provided as middleware that you can include anywhere in your application.

####Authentication of Application Installation
This will verify that there is a session with an authorised OAuth token. If no session data is found, we will automatically redirect to the install flow to retrieve the token. If we already have session data, then we will add the session data into the ShopifyAuth object to be referenced later, as well as add `res.locals.shop` which will contain the current Shopify shop

For example, if your app serves it's Shopify App at the `/app` endpoint, and you require that we have authenticated access to Shopify, then you can use the `authenticate` middleware like this:
```js
app.use('/app', ShopifyAuth.authenticate(), auth_routes);
```
By Default, if you use the included Install Flow (see below), and there is no authenticated session, we will automatically redirect to the install route to authenticate.
If you build your own install flow, you can provide the path to it as an option to the `authenticate()` middleware like this:
```js
app.use('/app', ShopifyAuth.authenticate({
  failed_redirect: '/your/own/install/path'
}), auth_routes);
```

#### Options
Option              | Default       | Description 
:------------------ | :------------ | :------------------------------------------------------
`failed_redirect`   |               | **Callback Signature: `callback()`.** If the request is deemed to be unauthorized, and we do not know where to redirect to get authentication, then we will call this callback. If you do not provide a callback, the request will be returned `401 Unauthorized`


####Authentication of Incoming Requests
This will verify that any requests to your application that originated from Shopify are authentic. This includes both admin/POS requests, as well as Webhooks created by the API. In both cases, the requests are signed with an HMAC signature. While Shopify signs the Admin/POS requests differently than the Webhook requests, we provide a common middleware for both that will derive the request type and check the signature correctly

To see the details of the request signatures, see https://docs.shopify.com/api/authentication/oauth#verification

If you have set up Webhooks through the API, and set their endpoints to '/webhooks', the following signature validation can be used:
```js
app.use('/webhooks', ShopifyAuth.verifyHMAC(), webhook_routes);
```

You can also include options that control how the verification is managed

#### Options
Option              | Default       | Description 
:------------------ | :------------ | :------------------------------------------------------
`allow_no_hmac`     | `true`        | Should the request be allowed if no HMAC was found on the request. The HMAC is sent as either a query param called `hmac`, or a request header called `x-shopify-hmac-sha256`
`no_hmac_callback`  |               | **Callback Signature: `callback(req, res, next)`.** If you set `allow_no_hmac` to `false`, then you can provide a callback which will be called. You can then handle the request from there. If you do not provide a callback, then the request will be returned with `401 Unauthorized`


Mounting the Included Install Flow
----------------------------------

Included in the module is a standard install flow pre-built that you just need to mount to an Express route. To mount the routes, include the following. If you are mounting the install flow somewhere other than the base path, you will also need to inlcude the `install_mount_path` option. 

For example, if you wanted to mount the install flow on the `/auth` route, and change the `/complete` route to `/install-done`, you would code the following
```js
ShopifyAuth.setOptions({install_mount_path: '/auth'});
app.use('/auth', ShopifyAuth.mount({
  complete_route: '/install-done'
}));
```

By default, this will create two routes: `/install` and `/complete`. The `/complete` path is where your `redirect_uri` should be pointed. Additionally, the `/complete` route will redirect back to the base path of your application. You can provide the following options.

#### Options

Option              | Default       | Description 
:------------------ | :------------ | :------------------------------------------------------
`install_route`     | `/install`    | The route that you would like to use to start the installation flow for your app. This route expects that there is a query param called `shop` present when called
`complete_route`    | `/complete`   | The route that you would like to use to complete the installation flow for your app. This path will need to be included in the list of Redirect URI's in your App's settings on Shopify
`complete_callback` |               | **Callback Signature: `callback(req, res)`.** If you would like to attach your own functionality to the install flow, you can provide a callback that will be triggered instead of redirecting to the site's base path. Your callback MUST end the response by either rendering content or redirecting.

Making API Calls to Shopify
---------------------------

Once you have authenticated the request, you can then make API calls to Shopify. You can call either the generic `request()` method or one of the convenience methods: `get()`, `post()`, `put()` and `delete()`

For example, if you want to retrieve a list of products, you can issue the following call. You can find details on the Shopify API at https://docs.shopify.com/api

```js
ShopifyAuth.get('/admin/products.json', function(err, data){
  //API Request has completed, you can now action the data, or err
  if (err) {
    //Handle Err
  } else {
    //Handle products
    var products = data;
  }
});
```

If you want to create a new webhook, you would issue the following
```js
var new_webhook = {
  webhook: {
    topic: 'orders/updated',
    address: 'https://your.site.com/path/to/webhook/handler',
    format: 'json'
  }
};
ShopifyAuth.post('/admin/webhooks.json', new_webhook, function(err, data){
  //API Request has completed, you can now action the data, or err
  if (err) {
    //Handle Err
  } else {
    //data contains info about the new webhook
    var products = data;
  }
});
```

Here are the method signatures for the convenience methods and the general method

Method         | Method Signature
:------------- | :---------------------------------------
`request()`    | `ShopifyAuth.request(endpoint, action, data, callback)`
`get()`        | `ShopifyAuth.get(endpoint, callback)`
`post()`       | `ShopifyAuth.post(endpoint, data, callback)`
`put()`        | `ShopifyAuth.put(endpoint, data, callback)`
`delete()`     | `ShopifyAuth.delete(endpoint, data, callback)`

Parameter      | Description
:------------- | :---------------------------------------
`endpoint`     | This is the API endpoint that you want to access. They are listed in the Shopify API docs, and should start with `/admin`
`action`       | This is the HTTP action that you want to use for the request, for example `GET`, `POST`, `PUT`, or `DELETE`
`data`         | A JSON object that you want to pass to the Shopify API endpoint
`callback`     | **Callback Signature: `callback(err, data, headers).`** The callback is issues when the http request to the Shopify API returns. If there is an HTTP error, or if Shopify returns an error, then the `err` object will contain the error. Otherwise `data` will contains the results of the API call. `headers` contains all of the response headers from the API call.



