<?php
/**
 * The "push on publish" request body and what the answer means.
 *
 * @package OpenPush
 */

defined( 'ABSPATH' ) || exit;

/**
 * Pure helpers for the publish push: no WordPress state is read here.
 */
final class OpenPush_Push_Payload {

	/** Longest title the plugin sends. */
	const TITLE_MAX = 100;

	/** Longest message the plugin sends. */
	const MESSAGE_MAX = 200;

	/** Words taken from the content when a post has no excerpt. */
	const EXCERPT_WORDS = 30;

	/**
	 * The `POST /v1/apps/{app}/messages` body. The audience is every subscribed browser of the app:
	 * the server leaves out anyone who unsubscribed.
	 *
	 * @param array $post {
	 *     Post values.
	 *
	 *     @type string $title          The post title.
	 *     @type string $excerpt        The excerpt, or an empty string.
	 *     @type string $content        The content, used when there is no excerpt.
	 *     @type string $permalink      The post's address.
	 *     @type string $image          The featured image address, or an empty string.
	 *     @type string $custom_title   The title typed in the box, or an empty string.
	 *     @type string $custom_message The message typed in the box, or an empty string.
	 *     @type string $site_name      The site name, used when the post has no title.
	 * }
	 * @return array
	 */
	public static function build( array $post ) {
		$title = self::clean( self::value( $post, 'custom_title' ), self::TITLE_MAX );
		if ( '' === $title ) {
			$title = self::clean( self::value( $post, 'title' ), self::TITLE_MAX );
		}
		if ( '' === $title ) {
			$title = self::clean( self::value( $post, 'site_name' ), self::TITLE_MAX );
		}
		$message = self::clean( self::value( $post, 'custom_message' ), self::MESSAGE_MAX );
		if ( '' === $message ) {
			$message = self::clean( self::value( $post, 'excerpt' ), self::MESSAGE_MAX );
		}
		if ( '' === $message ) {
			$message = self::clean( self::first_words( self::value( $post, 'content' ), self::EXCERPT_WORDS ), self::MESSAGE_MAX );
		}

		$body = array(
			'name'      => $title,
			'title'     => $title,
			'deep_link' => self::value( $post, 'permalink' ),
			'target'    => array( 'platforms' => array( 'web' ) ),
		);
		if ( '' !== $message ) {
			$body['body'] = $message;
		}
		$image = self::value( $post, 'image' );
		if ( 0 === strpos( $image, 'https://' ) ) {
			$body['image_url'] = $image;
		}
		return $body;
	}

	/**
	 * The Idempotency-Key: `wp-<site>-<post id>`, where `<site>` is a short hash of the home URL,
	 * so a retry of the same post never sends twice.
	 *
	 * @param string $home_url The site's home URL.
	 * @param int    $post_id  The post ID.
	 * @return string
	 */
	public static function idempotency_key( $home_url, $post_id ) {
		return 'wp-' . substr( hash( 'sha256', (string) $home_url ), 0, 12 ) . '-' . (int) $post_id;
	}

	/**
	 * What the server's answer means, in one sentence.
	 *
	 * @param int        $status The HTTP status, or 0 when the server could not be reached.
	 * @param array|null $body   The decoded JSON body.
	 * @return array{ok: bool, type: string, message: string}
	 */
	public static function interpret( $status, $body ) {
		if ( 202 === $status && is_array( $body ) && isset( $body['status'] ) && 'pending_approval' === $body['status'] ) {
			return self::result( true, 'info', __( 'The push is waiting for approval in OpenPush.', 'openpush' ) );
		}
		if ( 200 === $status || 202 === $status ) {
			if ( is_array( $body ) && isset( $body['provider_accepted'] ) && is_int( $body['provider_accepted'] ) ) {
				$count = $body['provider_accepted'];
				return self::result(
					true,
					'success',
					sprintf(
						/* translators: %s: number of browsers. */
						_n( 'Push sent to %s browser.', 'Push sent to %s browsers.', $count, 'openpush' ),
						number_format( $count )
					)
				);
			}
			return self::result( true, 'success', __( 'Push sent.', 'openpush' ) );
		}
		if ( 404 === $status ) {
			return self::result( false, 'info', __( 'No one has subscribed yet, so no push was sent.', 'openpush' ) );
		}
		if ( 409 === $status ) {
			return self::result( true, 'info', __( 'This push was already sent.', 'openpush' ) );
		}
		if ( 401 === $status ) {
			return self::result( false, 'error', __( "Push not sent: OpenPush didn't accept the REST API key.", 'openpush' ) );
		}
		if ( 403 === $status ) {
			return self::result( false, 'error', __( "Push not sent: this REST API key can't send pushes.", 'openpush' ) );
		}
		if ( 400 === $status ) {
			$detail = is_array( $body ) && isset( $body['detail'] ) && is_string( $body['detail'] ) ? self::clean( $body['detail'], 200 ) : '';
			return self::result(
				false,
				'error',
				'' === $detail
					? __( 'Push not sent: OpenPush refused it.', 'openpush' )
					/* translators: %s: the reason OpenPush gave. */
					: sprintf( __( 'Push not sent: %s', 'openpush' ), $detail )
			);
		}
		if ( 0 === $status ) {
			return self::result( false, 'error', __( "Push not sent: couldn't reach OpenPush.", 'openpush' ) );
		}
		return self::result( false, 'error', __( 'Push not sent: OpenPush had a problem. Try again later.', 'openpush' ) );
	}

	/**
	 * Plain text: no tags or shortcode brackets, entities decoded, spaces collapsed, cut to a length.
	 *
	 * @param string $text Text or HTML.
	 * @param int    $max  The longest result, in characters.
	 * @return string
	 */
	public static function clean( $text, $max ) {
		$text = preg_replace( '/<(script|style)\b[^>]*>.*?<\/\1>/is', ' ', (string) $text );
		$text = preg_replace( '/\[[^\]]*\]/', ' ', strip_tags( (string) $text ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- script and style are removed above.
		$text = html_entity_decode( (string) $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$text = trim( (string) preg_replace( '/\s+/u', ' ', $text ) );
		if ( self::length( $text ) <= $max ) {
			return $text;
		}
		return rtrim( self::cut( $text, $max - 1 ) ) . "\u{2026}";
	}

	/**
	 * The first words of a text.
	 *
	 * @param string $text  Text or HTML.
	 * @param int    $count How many words.
	 * @return string
	 */
	public static function first_words( $text, $count ) {
		$plain = self::clean( $text, PHP_INT_MAX );
		$words = preg_split( '/\s+/u', $plain, -1, PREG_SPLIT_NO_EMPTY );
		if ( ! is_array( $words ) || count( $words ) <= $count ) {
			return $plain;
		}
		return implode( ' ', array_slice( $words, 0, $count ) ) . "\u{2026}";
	}

	/**
	 * A string value from the post array.
	 *
	 * @param array  $post The post values.
	 * @param string $key  The key.
	 * @return string
	 */
	private static function value( array $post, $key ) {
		return isset( $post[ $key ] ) && is_scalar( $post[ $key ] ) ? (string) $post[ $key ] : '';
	}

	/**
	 * Length in characters.
	 *
	 * @param string $text Text.
	 * @return int
	 */
	private static function length( $text ) {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $text, 'UTF-8' ) : strlen( $text );
	}

	/**
	 * The first characters of a text.
	 *
	 * @param string $text Text.
	 * @param int    $max  How many characters.
	 * @return string
	 */
	private static function cut( $text, $max ) {
		return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, $max, 'UTF-8' ) : substr( $text, 0, $max );
	}

	/**
	 * A result row.
	 *
	 * @param bool   $ok      Whether the push went out (or was already sent, or waits for approval).
	 * @param string $type    `success`, `info` or `error`.
	 * @param string $message The sentence.
	 * @return array{ok: bool, type: string, message: string}
	 */
	private static function result( $ok, $type, $message ) {
		return array(
			'ok'      => $ok,
			'type'    => $type,
			'message' => $message,
		);
	}
}
