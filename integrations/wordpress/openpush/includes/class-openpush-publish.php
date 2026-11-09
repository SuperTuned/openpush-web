<?php
/**
 * Optional "send a push when published" for posts.
 *
 * A push goes out once, when a post is first published with the box checked, and never on later
 * updates. In the block editor the post is published first and the box's values are saved in a
 * second request a moment later, so the send waits for that request; a short scheduled fallback
 * covers publishing without the editor (or with the box hidden).
 *
 * @package OpenPush
 */

defined( 'ABSPATH' ) || exit;

/**
 * The meta box, the hooks that decide when to send, and the send itself.
 *
 * Filter: `openpush_post_types` (array) lists the post types that get the box. Default: post.
 */
final class OpenPush_Publish {

	/** Post meta: the box is checked. */
	const META_SEND = '_openpush_send';

	/** Post meta: the title typed in the box. */
	const META_TITLE = '_openpush_title';

	/** Post meta: the message typed in the box. */
	const META_MESSAGE = '_openpush_message';

	/** Post meta: when the post was first published (while the plugin was active). */
	const META_PUBLISHED = '_openpush_published';

	/** Post meta: the send result, so a post is never sent twice. */
	const META_RESULT = '_openpush_result';

	/** How long after the first publish a send may still start, in seconds. */
	const WINDOW = 900;

	/** The scheduled fallback hook. */
	const CRON_HOOK = 'openpush_send_post';

	/** Seconds before the fallback runs. */
	const CRON_DELAY = 60;

	/**
	 * Hooks into WordPress.
	 *
	 * @return void
	 */
	public static function register() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_box' ) );
		add_action( 'save_post', array( __CLASS__, 'save_box' ), 10, 2 );
		add_action( 'transition_post_status', array( __CLASS__, 'on_transition' ), 10, 3 );
		add_action( 'wp_after_insert_post', array( __CLASS__, 'after_insert' ), 10, 2 );
		add_action( self::CRON_HOOK, array( __CLASS__, 'maybe_send' ) );
		add_action( 'admin_notices', array( __CLASS__, 'show_notice' ) );
	}

	/**
	 * The post types with the box.
	 *
	 * @return string[]
	 */
	private static function post_types() {
		$types = apply_filters( 'openpush_post_types', array( 'post' ) );
		return is_array( $types ) ? array_values( array_filter( $types, 'is_string' ) ) : array( 'post' );
	}

	/**
	 * Adds the box to the editor's side.
	 *
	 * @return void
	 */
	public static function add_box() {
		foreach ( self::post_types() as $type ) {
			add_meta_box( 'openpush-push', __( 'Push notification', 'openpush' ), array( __CLASS__, 'render_box' ), $type, 'side' );
		}
	}

	/**
	 * Renders the box.
	 *
	 * @param WP_Post $post The post.
	 * @return void
	 */
	public static function render_box( $post ) {
		$result = get_post_meta( $post->ID, self::META_RESULT, true );
		if ( is_array( $result ) && isset( $result['message'] ) ) {
			echo '<p>' . esc_html( $result['message'] ) . '</p>';
			return;
		}
		if ( '' === OpenPush_Settings::rest_api_key() ) {
			printf(
				'<p>%s <a href="%s">%s</a></p>',
				esc_html__( 'To send a push when you publish, add a REST API key.', 'openpush' ),
				esc_url( add_query_arg( 'page', OpenPush_Admin::PAGE, admin_url( 'options-general.php' ) ) ),
				esc_html__( 'Settings', 'openpush' )
			);
			return;
		}
		if ( 'publish' === $post->post_status && ! self::in_window( $post->ID ) ) {
			echo '<p>' . esc_html__( 'A push goes out only when a post is first published.', 'openpush' ) . '</p>';
			return;
		}
		wp_nonce_field( 'openpush_box', 'openpush_box_nonce' );
		$checked = '1' === get_post_meta( $post->ID, self::META_SEND, true );
		?>
		<p>
			<label><input type="checkbox" name="openpush_send" value="1"<?php checked( $checked ); ?>> <?php esc_html_e( 'Send a push when published', 'openpush' ); ?></label>
		</p>
		<p>
			<label for="openpush-push-title"><?php esc_html_e( 'Title', 'openpush' ); ?></label>
			<input type="text" id="openpush-push-title" name="openpush_title" class="widefat" maxlength="<?php echo (int) OpenPush_Push_Payload::TITLE_MAX; ?>" value="<?php echo esc_attr( get_post_meta( $post->ID, self::META_TITLE, true ) ); ?>" placeholder="<?php esc_attr_e( 'The post title', 'openpush' ); ?>">
		</p>
		<p>
			<label for="openpush-push-message"><?php esc_html_e( 'Message', 'openpush' ); ?></label>
			<textarea id="openpush-push-message" name="openpush_message" class="widefat" rows="2" maxlength="<?php echo (int) OpenPush_Push_Payload::MESSAGE_MAX; ?>" placeholder="<?php esc_attr_e( 'The post excerpt', 'openpush' ); ?>"><?php echo esc_textarea( get_post_meta( $post->ID, self::META_MESSAGE, true ) ); ?></textarea>
		</p>
		<?php
	}

	/**
	 * Saves the box (classic editor save, and the block editor's meta box request).
	 *
	 * @param int     $post_id The post ID.
	 * @param WP_Post $post    The post.
	 * @return void
	 */
	public static function save_box( $post_id, $post ) {
		if ( ! isset( $_POST['openpush_box_nonce'] ) || ! wp_verify_nonce( sanitize_key( wp_unslash( $_POST['openpush_box_nonce'] ) ), 'openpush_box' ) ) {
			return;
		}
		if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) || ! in_array( $post->post_type, self::post_types(), true ) ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}
		if ( ! empty( $_POST['openpush_send'] ) ) {
			update_post_meta( $post_id, self::META_SEND, '1' );
		} else {
			delete_post_meta( $post_id, self::META_SEND );
		}
		$title   = isset( $_POST['openpush_title'] ) ? sanitize_text_field( wp_unslash( $_POST['openpush_title'] ) ) : '';
		$message = isset( $_POST['openpush_message'] ) ? sanitize_textarea_field( wp_unslash( $_POST['openpush_message'] ) ) : '';
		self::store_text( $post_id, self::META_TITLE, OpenPush_Push_Payload::clean( $title, OpenPush_Push_Payload::TITLE_MAX ) );
		self::store_text( $post_id, self::META_MESSAGE, OpenPush_Push_Payload::clean( $message, OpenPush_Push_Payload::MESSAGE_MAX ) );
	}

	/**
	 * Stores a text value, or removes it when empty.
	 *
	 * @param int    $post_id The post ID.
	 * @param string $key     The meta key.
	 * @param string $value   The value.
	 * @return void
	 */
	private static function store_text( $post_id, $key, $value ) {
		if ( '' === $value ) {
			delete_post_meta( $post_id, $key );
		} else {
			update_post_meta( $post_id, $key, $value );
		}
	}

	/**
	 * Notes the first publish of a post.
	 *
	 * @param string  $new_status The new status.
	 * @param string  $old_status The old status.
	 * @param WP_Post $post       The post.
	 * @return void
	 */
	public static function on_transition( $new_status, $old_status, $post ) {
		if ( 'publish' !== $new_status || 'publish' === $old_status || 'trash' === $old_status ) {
			return;
		}
		if ( ! in_array( $post->post_type, self::post_types(), true ) || '' !== (string) get_post_meta( $post->ID, self::META_PUBLISHED, true ) ) {
			return;
		}
		update_post_meta( $post->ID, self::META_PUBLISHED, time() );
	}

	/**
	 * After a save: sends now, or, in a block editor (REST) save, schedules the fallback and lets
	 * the meta box request that follows send with the box's latest values.
	 *
	 * @param int     $post_id The post ID.
	 * @param WP_Post $post    The post.
	 * @return void
	 */
	public static function after_insert( $post_id, $post ) {
		if ( ! in_array( $post->post_type, self::post_types(), true ) || ! self::due( $post_id ) ) {
			return;
		}
		if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
			if ( ! wp_next_scheduled( self::CRON_HOOK, array( $post_id ) ) ) {
				wp_schedule_single_event( time() + self::CRON_DELAY, self::CRON_HOOK, array( $post_id ) );
			}
			return;
		}
		self::maybe_send( $post_id );
	}

	/**
	 * True while the post is inside the first-publish window.
	 *
	 * @param int $post_id The post ID.
	 * @return bool
	 */
	private static function in_window( $post_id ) {
		$published = (int) get_post_meta( $post_id, self::META_PUBLISHED, true );
		return $published > 0 && time() - $published <= self::WINDOW;
	}

	/**
	 * True when the post should be sent now: published for the first time, box checked, a key
	 * saved, and not sent yet.
	 *
	 * @param int $post_id The post ID.
	 * @return bool
	 */
	private static function due( $post_id ) {
		return 'publish' === get_post_status( $post_id )
			&& '1' === get_post_meta( $post_id, self::META_SEND, true )
			&& ! metadata_exists( 'post', $post_id, self::META_RESULT )
			&& self::in_window( $post_id )
			&& '' !== OpenPush_Settings::rest_api_key();
	}

	/**
	 * Sends the post's push if it is due, once.
	 *
	 * @param int $post_id The post ID.
	 * @return void
	 */
	public static function maybe_send( $post_id ) {
		$post_id = (int) $post_id;
		$post    = get_post( $post_id );
		if ( ! $post || ! in_array( $post->post_type, self::post_types(), true ) || ! self::due( $post_id ) ) {
			return;
		}
		// Claim the post first, so a second request in the same moment does not send again.
		if ( ! add_post_meta( $post_id, self::META_RESULT, array( 'message' => __( 'Sending the push…', 'openpush' ) ), true ) ) {
			return;
		}
		wp_clear_scheduled_hook( self::CRON_HOOK, array( $post_id ) );

		if ( '' !== $post->post_password ) {
			$result = array(
				'ok'      => false,
				'type'    => 'info',
				'message' => __( 'No push was sent: the post is password protected.', 'openpush' ),
			);
		} else {
			$result = self::send( $post );
		}
		$result['at'] = time();
		update_post_meta( $post_id, self::META_RESULT, $result );

		$user = get_current_user_id() ? get_current_user_id() : (int) $post->post_author;
		if ( $user ) {
			set_transient( 'openpush_notice_' . $user, $result, 10 * MINUTE_IN_SECONDS );
		}
	}

	/**
	 * Calls the messages API.
	 *
	 * @param WP_Post $post The post.
	 * @return array{ok: bool, type: string, message: string}
	 */
	private static function send( $post ) {
		$settings = OpenPush_Settings::get();
		if ( '' === $settings['app_id'] ) {
			return array(
				'ok'      => false,
				'type'    => 'error',
				'message' => __( 'Push not sent: add your App ID in Settings › OpenPush.', 'openpush' ),
			);
		}
		$image    = get_the_post_thumbnail_url( $post, 'large' );
		$payload  = OpenPush_Push_Payload::build(
			array(
				'title'          => get_the_title( $post ),
				'excerpt'        => $post->post_excerpt,
				'content'        => excerpt_remove_blocks( strip_shortcodes( $post->post_content ) ),
				'permalink'      => get_permalink( $post ),
				'image'          => is_string( $image ) ? $image : '',
				'custom_title'   => get_post_meta( $post->ID, self::META_TITLE, true ),
				'custom_message' => get_post_meta( $post->ID, self::META_MESSAGE, true ),
				'site_name'      => get_bloginfo( 'name' ),
			)
		);
		$response = wp_remote_post(
			$settings['server'] . '/v1/apps/' . rawurlencode( $settings['app_id'] ) . '/messages',
			array(
				'timeout'     => 15,
				'redirection' => 0,
				'headers'     => array(
					'Content-Type'    => 'application/json',
					'Accept'          => 'application/json',
					'X-OP-API-Key'    => OpenPush_Settings::rest_api_key(),
					'Idempotency-Key' => OpenPush_Push_Payload::idempotency_key( home_url( '/' ), $post->ID ),
				),
				'body'        => wp_json_encode( $payload ),
				'data_format' => 'body',
			)
		);
		if ( is_wp_error( $response ) ) {
			return OpenPush_Push_Payload::interpret( 0, null );
		}
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		return OpenPush_Push_Payload::interpret( (int) wp_remote_retrieve_response_code( $response ), is_array( $body ) ? $body : null );
	}

	/**
	 * Shows the last send result once, to the person who published.
	 *
	 * @return void
	 */
	public static function show_notice() {
		$key    = 'openpush_notice_' . get_current_user_id();
		$result = get_transient( $key );
		if ( ! is_array( $result ) || empty( $result['message'] ) ) {
			return;
		}
		delete_transient( $key );
		$type = isset( $result['type'] ) && in_array( $result['type'], array( 'success', 'info', 'error' ), true ) ? $result['type'] : 'info';
		printf(
			'<div class="notice notice-%s is-dismissible"><p>%s</p></div>',
			esc_attr( $type ),
			esc_html( $result['message'] )
		);
	}
}
