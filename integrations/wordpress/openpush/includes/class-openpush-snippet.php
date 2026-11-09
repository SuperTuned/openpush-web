<?php
/**
 * The script tag and the initialize snippet.
 *
 * @package OpenPush
 */

defined( 'ABSPATH' ) || exit;

/**
 * Builds what goes on each page. Pure: no WordPress state is read here.
 */
final class OpenPush_Snippet {

	/** Where the server serves the page SDK. */
	const SDK_PATH = '/sdk/web/v2/openpush.js';

	/**
	 * The SDK script URL.
	 *
	 * @param string $server A sanitized server origin.
	 * @return string
	 */
	public static function script_url( $server ) {
		return $server . self::SDK_PATH;
	}

	/**
	 * The options passed to `OpenPush.initialize`. Prompts, the welcome notification and click
	 * behaviour come from the OpenPush console, so they are not passed here.
	 *
	 * @param string $app_id      The app ID.
	 * @param array  $worker      `path` and `scope` of the worker file.
	 * @param string $server      A sanitized server origin.
	 * @param string $nonce       A CSP nonce for the prompt styles, or an empty string.
	 * @return array
	 */
	public static function init_options( $app_id, array $worker, $server, $nonce ) {
		$options = array(
			'appId'              => $app_id,
			'serviceWorkerPath'  => $worker['path'],
			'serviceWorkerScope' => $worker['scope'],
		);
		// The SDK finds the server from its script address; a self-hosted one is also passed, in
		// case an optimisation plugin moves the script.
		if ( ! OpenPush_Settings::is_default_server( $server ) ) {
			$options['serverUrl'] = $server;
		}
		if ( '' !== $nonce ) {
			$options['nonce'] = $nonce;
		}
		return $options;
	}

	/**
	 * The inline script. It runs before the SDK loads and queues the initialize call, so the SDK
	 * script can stay deferred.
	 *
	 * @param array $options Options from init_options().
	 * @return string
	 */
	public static function inline( array $options ) {
		$json = wp_json_encode( $options, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES );
		return 'window.OpenPushDeferred=window.OpenPushDeferred||[];'
			. 'window.OpenPushDeferred.push(function(OpenPush){return OpenPush.initialize(' . $json . ');});';
	}

	/**
	 * Adds a nonce attribute to every script tag in the markup that has none.
	 *
	 * @param string $markup The script tags.
	 * @param string $nonce  The nonce.
	 * @return string
	 */
	public static function add_nonce( $markup, $nonce ) {
		if ( '' === $nonce ) {
			return $markup;
		}
		$attribute = ' nonce="' . htmlspecialchars( $nonce, ENT_QUOTES, 'UTF-8' ) . '"';
		return (string) preg_replace( '/<script(?![^>]*\snonce=)(?=[\s>])/i', '<script' . $attribute, $markup );
	}

	/**
	 * A nonce value: base64 characters only, or an empty string.
	 *
	 * @param mixed $raw The filtered value.
	 * @return string
	 */
	public static function sanitize_nonce( $raw ) {
		$value = is_string( $raw ) ? trim( $raw ) : '';
		return 1 === preg_match( '#^[A-Za-z0-9+/_=-]{1,128}$#', $value ) ? $value : '';
	}
}
