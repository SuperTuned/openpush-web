=== OpenPush ===
Contributors: openpush
Tags: web push, push notifications, notifications, browser notifications
Requires at least: 6.3
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Send web push to your visitors with OpenPush. Paste your App ID and you're set: prompts and messages are managed in the OpenPush console.

== Description ==

OpenPush sends push notifications to browsers on desktop and phone: Chrome, Edge, Firefox and Safari, and iPhone and iPad when your site is added to the Home Screen.

This plugin connects your WordPress site to your OpenPush app:

* Adds the OpenPush script to every page of your site.
* Hosts the worker file browsers need for push, from the plugin's own folder. Nothing to upload, no file in your site's root.
* Can send a push when you publish a post, with the post title, excerpt, link and featured image. You choose per post; it's off by default.

You set up everything else in the OpenPush console: the prompts that ask visitors to subscribe, the welcome notification, what a click opens, and every push you send.

== Installation ==

1. In the OpenPush console, open Settings › Push & In-App › Web and choose WordPress as the setup type. Enter your site's address exactly as visitors see it.
2. Install and activate this plugin.
3. Go to Settings › OpenPush and paste the App ID and Site key from the console.
4. To send pushes when you publish, also paste a REST API key.
5. Click Check connection.
6. Back in the console, finish the Verify step.

== Frequently Asked Questions ==

= Can one OpenPush app serve several sites? =

No. One app serves one site address. For a second site, create a second app in OpenPush.

= Does www matter? =

Yes. `https://www.example.com` and `https://example.com` are different sites to a browser, and subscribers on one aren't subscribed on the other. Use the address your site really opens on, and redirect the other one to it.

= Does it work on iPhone and iPad? =

Yes, on iOS and iPadOS 16.4 or later, once a visitor adds your site to the Home Screen and opens it from there. In a normal Safari tab, Apple doesn't allow web push.

= Where is the worker file? =

In the plugin's `worker` folder. Browsers load it from there, and it covers only that folder, so it never clashes with another worker your site uses (for example an offline or app plugin). Don't move it or set another worker location in the console.

= When is a push sent for a post? =

Only when the post is first published and "Send a push when published" is checked. Updates never send a push. It goes to everyone subscribed to your site; people who unsubscribed never get it.

= I use a Content Security Policy =

The plugin's scripts can carry your nonce: return it from the `openpush_script_nonce` filter.

= Can I leave the script off some pages? =

Yes: return false from the `openpush_enqueue` filter on those pages.

= Can I use my own OpenPush server? =

Yes. Set its address under Settings › OpenPush › Advanced. The plugin then writes its worker file to `wp-content/uploads/openpush/`, so that folder must be writable.

== External services ==

This plugin connects to OpenPush, the service that sends your push notifications (https://app.openpush.ai by default, or your own server if you set one).

* On every page of your site, visitors' browsers load the OpenPush script and worker code from that server. When a visitor subscribes, their browser sends its push address, browser and language to OpenPush.
* When you click Check connection, your site asks OpenPush for your app's public site settings.
* When you publish a post with "Send a push when published" checked, your site sends the post's title, excerpt, link and featured image address to OpenPush with your REST API key.

Terms: https://openpush.ai/terms
Privacy: https://openpush.ai/privacy

== Changelog ==

= 1.0.0 =
* First release.
