<?php
/**
 * Loads the plugin's pure helpers with small stand-ins for the WordPress functions they call.
 * These tests do not need a WordPress install.
 *
 * @package OpenPush
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'OPENPUSH_FILE', dirname( __DIR__ ) . '/openpush.php' );

require dirname( __DIR__ ) . '/vendor/autoload.php';

function __( $text, $domain = 'default' ) {
	return $text;
}

function _n( $single, $plural, $number, $domain = 'default' ) {
	return 1 === $number ? $single : $plural;
}

function wp_json_encode( $data, $options = 0, $depth = 512 ) {
	return json_encode( $data, $options, $depth );
}

function wp_parse_url( $url, $component = -1 ) {
	return parse_url( $url, $component );
}

function plugins_url( $path = '', $plugin = '' ) {
	return 'https://blog.example.com/wp-content/plugins/openpush/' . ltrim( $path, '/' );
}

require dirname( __DIR__ ) . '/includes/class-openpush-settings.php';
require dirname( __DIR__ ) . '/includes/class-openpush-worker.php';
require dirname( __DIR__ ) . '/includes/class-openpush-snippet.php';
require dirname( __DIR__ ) . '/includes/class-openpush-connection.php';
require dirname( __DIR__ ) . '/includes/class-openpush-push-payload.php';
