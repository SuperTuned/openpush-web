<?php
/**
 * Adds the SDK to front-end pages.
 *
 * @package OpenPush
 */

defined( 'ABSPATH' ) || exit;

/**
 * Enqueues the SDK script (deferred) with the initialize snippet before it.
 *
 * Filters for site developers:
 * - `openpush_enqueue` (bool): return false to leave the SDK off a page.
 * - `openpush_script_nonce` (string): a CSP nonce for the plugin's two script tags and the
 *   prompt styles.
 */
final class OpenPush_Frontend {

	/** The script handle. */
	const HANDLE = 'openpush-sdk';

	/**
	 * Hooks into WordPress.
	 *
	 * @return void
	 */
	public static function register() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_filter( 'script_loader_tag', array( __CLASS__, 'script_tag' ), 10, 2 );
	}

	/**
	 * The nonce from the `openpush_script_nonce` filter, or an empty string.
	 *
	 * @return string
	 */
	private static function nonce() {
		return OpenPush_Snippet::sanitize_nonce( apply_filters( 'openpush_script_nonce', '' ) );
	}

	/**
	 * Enqueues the SDK when an App ID is set.
	 *
	 * @return void
	 */
	public static function enqueue() {
		$settings = OpenPush_Settings::get();
		if ( '' === $settings['app_id'] ) {
			return;
		}
		if ( function_exists( 'amp_is_request' ) && amp_is_request() ) {
			return;
		}
		if ( ! apply_filters( 'openpush_enqueue', true ) ) {
			return;
		}
		$worker = OpenPush_Worker::location( $settings['server'] );
		// No version argument: the server's v2 path is the version, and a `ver` query would only
		// split the cache.
		wp_enqueue_script(
			self::HANDLE,
			OpenPush_Snippet::script_url( $settings['server'] ),
			array(),
			null, // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion -- see above.
			array(
				'strategy'  => 'defer',
				'in_footer' => false,
			)
		);
		// "before": the snippet only queues the call, so the SDK keeps its defer strategy.
		wp_add_inline_script(
			self::HANDLE,
			OpenPush_Snippet::inline( OpenPush_Snippet::init_options( $settings['app_id'], $worker, $settings['server'], self::nonce() ) ),
			'before'
		);
	}

	/**
	 * Adds the nonce to the plugin's script tags.
	 *
	 * @param string $tag    The script markup.
	 * @param string $handle The script handle.
	 * @return string
	 */
	public static function script_tag( $tag, $handle ) {
		if ( self::HANDLE !== $handle ) {
			return $tag;
		}
		return OpenPush_Snippet::add_nonce( $tag, self::nonce() );
	}
}
