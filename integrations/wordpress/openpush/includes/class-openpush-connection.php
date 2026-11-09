<?php
/**
 * "Check connection": reads the app's public site config and says what it means.
 *
 * @package OpenPush
 */

defined( 'ABSPATH' ) || exit;

/**
 * Calls `GET {server}/v1/apps/{app}/webpush-config` and turns the answer into one plain sentence.
 */
final class OpenPush_Connection {

	/** The console's setup type for this plugin. */
	const SETUP_TYPE = 'wordpress'; // phpcs:ignore WordPress.WP.CapitalPDangit.MisspelledInText -- an API value.

	/**
	 * The config address for an app.
	 *
	 * @param string $server A sanitized server origin.
	 * @param string $app_id The app ID.
	 * @return string
	 */
	public static function config_url( $server, $app_id ) {
		return $server . '/v1/apps/' . rawurlencode( $app_id ) . '/webpush-config';
	}

	/**
	 * Runs the check.
	 *
	 * @param array  $settings    The settings from OpenPush_Settings::get().
	 * @param string $home_origin This site's origin.
	 * @return array{type: string, message: string}
	 */
	public static function check( array $settings, $home_origin ) {
		if ( '' === $settings['app_id'] ) {
			return self::result( 'error', __( 'Add your App ID first.', 'openpush' ) );
		}
		$response = wp_remote_get(
			self::config_url( $settings['server'], $settings['app_id'] ),
			array(
				'timeout'     => 10,
				'redirection' => 0,
				'headers'     => array( 'Accept' => 'application/json' ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return self::interpret( 0, null, $settings, $home_origin );
		}
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		return self::interpret( (int) wp_remote_retrieve_response_code( $response ), is_array( $body ) ? $body : null, $settings, $home_origin );
	}

	/**
	 * What an answer means for this site. Pure.
	 *
	 * @param int        $status      The HTTP status, or 0 when the server could not be reached.
	 * @param array|null $body        The decoded JSON body.
	 * @param array      $settings    The settings.
	 * @param string     $home_origin This site's origin.
	 * @return array{type: string, message: string}
	 */
	public static function interpret( $status, $body, array $settings, $home_origin ) {
		if ( 0 === $status ) {
			return self::result( 'error', __( "Couldn't reach OpenPush. Check the server address under Advanced.", 'openpush' ) );
		}
		if ( 404 === $status ) {
			return self::result( 'error', __( "OpenPush doesn't know this App ID. Check it in the OpenPush console.", 'openpush' ) );
		}
		if ( 429 === $status ) {
			return self::result( 'warning', __( 'Too many checks. Try again in a minute.', 'openpush' ) );
		}
		if ( 200 !== $status || null === $body ) {
			return self::result( 'error', __( 'OpenPush had a problem answering. Try again later.', 'openpush' ) );
		}
		if ( isset( $body['enabled'] ) && false === $body['enabled'] ) {
			return self::result( 'warning', __( 'Web push is off for this app. Turn it on in the OpenPush console.', 'openpush' ) );
		}
		$site = isset( $body['site'] ) && is_array( $body['site'] ) ? $body['site'] : null;
		if ( null === $site || empty( $site['origin'] ) ) {
			return self::result( 'warning', __( "This app isn't set up for a website yet. Set it up in the OpenPush console.", 'openpush' ) );
		}
		if ( '' !== $settings['site_key'] && ( ! isset( $body['sdk_key'] ) || $body['sdk_key'] !== $settings['site_key'] ) ) {
			return self::result( 'error', __( "The site key doesn't belong to this app. Copy both from the OpenPush console.", 'openpush' ) );
		}
		$origin = (string) $site['origin'];
		if ( $origin !== $home_origin ) {
			return self::result(
				'error',
				sprintf(
					/* translators: 1: the site address saved in OpenPush, 2: this site's address. */
					__( 'This app is set up for %1$s, but this site is %2$s. Use the same address in the OpenPush console, with or without www.', 'openpush' ),
					$origin,
					$home_origin
				)
			);
		}
		if ( ! isset( $body['setup_type'] ) || self::SETUP_TYPE !== $body['setup_type'] ) {
			return self::result( 'warning', __( 'Choose WordPress as the setup type in the OpenPush console, so this plugin can host the worker file.', 'openpush' ) );
		}
		if ( isset( $body['direct']['new_registrations'] ) && false === $body['direct']['new_registrations'] ) {
			return self::result( 'warning', __( "This app can't take new subscribers yet. Ask your OpenPush admin.", 'openpush' ) );
		}
		$name = isset( $site['name'] ) && '' !== (string) $site['name'] ? (string) $site['name'] : $origin;
		return self::result(
			'success',
			sprintf(
				/* translators: 1: the site name in OpenPush, 2: the site address. */
				__( 'Connected to %1$s on %2$s.', 'openpush' ),
				$name,
				$origin
			)
		);
	}

	/**
	 * A result row.
	 *
	 * @param string $type    `success`, `warning` or `error`.
	 * @param string $message The sentence.
	 * @return array{type: string, message: string}
	 */
	private static function result( $type, $message ) {
		return array(
			'type'    => $type,
			'message' => $message,
		);
	}
}
