<?php
/**
 * The plugin's stored settings and the rules for each value.
 *
 * @package OpenPush
 */

defined( 'ABSPATH' ) || exit;

/**
 * Reads and writes the settings. The sanitizers are pure, so they can be tested without WordPress.
 */
final class OpenPush_Settings {

	/** App ID, site key and server: needed on every page, so autoloaded. */
	const OPTION = 'openpush_settings';

	/** The REST API key: only for "push on publish", so never autoloaded. */
	const KEY_OPTION = 'openpush_rest_api_key';

	/** The last "Check connection" result. */
	const CHECK_OPTION = 'openpush_last_check';

	/** The OpenPush server unless a self-hosted one is set under Advanced. */
	const DEFAULT_SERVER = 'https://app.openpush.ai';

	/**
	 * The stored settings, with defaults.
	 *
	 * @return array{app_id: string, site_key: string, server: string}
	 */
	public static function get() {
		$stored = get_option( self::OPTION, array() );
		return self::normalize( is_array( $stored ) ? $stored : array() );
	}

	/**
	 * Fills defaults and drops unknown keys.
	 *
	 * @param array $values Stored values.
	 * @return array{app_id: string, site_key: string, server: string}
	 */
	public static function normalize( array $values ) {
		$server = isset( $values['server'] ) ? self::sanitize_server( $values['server'] ) : '';
		return array(
			'app_id'   => isset( $values['app_id'] ) ? self::sanitize_app_id( $values['app_id'] ) : '',
			'site_key' => isset( $values['site_key'] ) ? self::sanitize_key( $values['site_key'] ) : '',
			'server'   => '' === $server ? self::DEFAULT_SERVER : $server,
		);
	}

	/**
	 * Saves the settings.
	 *
	 * @param array $values App ID, site key and server.
	 * @return void
	 */
	public static function save( array $values ) {
		update_option( self::OPTION, self::normalize( $values ), true );
	}

	/**
	 * The saved REST API key, or an empty string.
	 *
	 * @return string
	 */
	public static function rest_api_key() {
		$key = get_option( self::KEY_OPTION, '' );
		return is_string( $key ) ? $key : '';
	}

	/**
	 * Saves the REST API key with autoload off, or removes it.
	 *
	 * @param string $key A sanitized key, or an empty string to remove it.
	 * @return void
	 */
	public static function save_rest_api_key( $key ) {
		if ( '' === $key ) {
			delete_option( self::KEY_OPTION );
			return;
		}
		// delete + add, so the option is stored with autoload off even if it once was on.
		delete_option( self::KEY_OPTION );
		add_option( self::KEY_OPTION, $key, '', false );
	}

	/**
	 * An app ID: letters, digits, dot, dash and underscore.
	 *
	 * @param mixed $raw Input.
	 * @return string The ID, or an empty string when it is not valid.
	 */
	public static function sanitize_app_id( $raw ) {
		$value = is_string( $raw ) ? trim( $raw ) : '';
		return 1 === preg_match( '/^[A-Za-z0-9._-]{1,100}$/', $value ) ? $value : '';
	}

	/**
	 * A site key or REST API key: 8 to 200 URL-safe characters.
	 *
	 * @param mixed $raw Input.
	 * @return string The key, or an empty string when it is not valid.
	 */
	public static function sanitize_key( $raw ) {
		$value = is_string( $raw ) ? trim( $raw ) : '';
		return 1 === preg_match( '/^[A-Za-z0-9._~-]{8,200}$/', $value ) ? $value : '';
	}

	/**
	 * A server address reduced to its origin: https, or http only for localhost.
	 *
	 * @param mixed $raw Input.
	 * @return string `scheme://host[:port]`, or an empty string when it is not valid.
	 */
	public static function sanitize_server( $raw ) {
		$value = is_string( $raw ) ? trim( $raw ) : '';
		if ( '' === $value ) {
			return '';
		}
		$origin = self::origin_of( $value );
		if ( '' === $origin ) {
			return '';
		}
		if ( 0 === strpos( $origin, 'https://' ) ) {
			return $origin;
		}
		return 1 === preg_match( '#^http://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin ) ? $origin : '';
	}

	/**
	 * The origin of a URL: lower-case scheme and host, and the port when it is not the default.
	 *
	 * @param string $url An absolute URL.
	 * @return string The origin, or an empty string.
	 */
	public static function origin_of( $url ) {
		$parts = wp_parse_url( (string) $url );
		if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
			return '';
		}
		$scheme = strtolower( $parts['scheme'] );
		$host   = strtolower( $parts['host'] );
		if ( ( 'https' !== $scheme && 'http' !== $scheme ) || 1 !== preg_match( '/^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/', $host ) ) {
			return '';
		}
		$origin = $scheme . '://' . $host;
		if ( isset( $parts['port'] ) ) {
			$port = (int) $parts['port'];
			if ( ! ( ( 'https' === $scheme && 443 === $port ) || ( 'http' === $scheme && 80 === $port ) ) ) {
				$origin .= ':' . $port;
			}
		}
		return $origin;
	}

	/**
	 * True when the server is OpenPush's own.
	 *
	 * @param string $server A sanitized server origin.
	 * @return bool
	 */
	public static function is_default_server( $server ) {
		return self::DEFAULT_SERVER === $server;
	}

	/**
	 * The last four characters of a saved key, for "ending in …".
	 *
	 * @param string $key A key.
	 * @return string
	 */
	public static function key_ending( $key ) {
		return strlen( $key ) >= 4 ? substr( $key, -4 ) : '';
	}
}
