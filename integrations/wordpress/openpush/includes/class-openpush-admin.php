<?php
/**
 * Settings › OpenPush.
 *
 * @package OpenPush
 */

defined( 'ABSPATH' ) || exit;

/**
 * The settings page, its two forms (save, check connection) and the plugin-list link.
 */
final class OpenPush_Admin {

	/** The page slug. */
	const PAGE = 'openpush';

	/** Who may change the settings. */
	const CAPABILITY = 'manage_options';

	/**
	 * Hooks into WordPress.
	 *
	 * @return void
	 */
	public static function register() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_openpush_save', array( __CLASS__, 'handle_save' ) );
		add_action( 'admin_post_openpush_check', array( __CLASS__, 'handle_check' ) );
		add_action( 'admin_notices', array( __CLASS__, 'setup_notice' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( OPENPUSH_FILE ), array( __CLASS__, 'action_links' ) );
	}

	/**
	 * On activation: for a self-hosted server, put its worker file back in place.
	 *
	 * @return void
	 */
	public static function activate() {
		$settings = OpenPush_Settings::get();
		if ( ! OpenPush_Settings::is_default_server( $settings['server'] ) ) {
			OpenPush_Worker::write_custom( $settings['server'] );
		}
	}

	/**
	 * The page URL.
	 *
	 * @param array $args Extra query arguments.
	 * @return string
	 */
	private static function page_url( array $args = array() ) {
		return add_query_arg( array_merge( array( 'page' => self::PAGE ), $args ), admin_url( 'options-general.php' ) );
	}

	/**
	 * Adds the page under Settings.
	 *
	 * @return void
	 */
	public static function menu() {
		add_options_page( __( 'OpenPush', 'openpush' ), __( 'OpenPush', 'openpush' ), self::CAPABILITY, self::PAGE, array( __CLASS__, 'render' ) );
	}

	/**
	 * "Settings" beside the plugin in the plugin list.
	 *
	 * @param array $links The links.
	 * @return array
	 */
	public static function action_links( array $links ) {
		array_unshift( $links, '<a href="' . esc_url( self::page_url() ) . '">' . esc_html__( 'Settings', 'openpush' ) . '</a>' );
		return $links;
	}

	/**
	 * A reminder on the dashboard and plugin list until the App ID is set.
	 *
	 * @return void
	 */
	public static function setup_notice() {
		$screen = get_current_screen();
		if ( ! $screen || ! in_array( $screen->id, array( 'dashboard', 'plugins' ), true ) || ! current_user_can( self::CAPABILITY ) ) {
			return;
		}
		$settings = OpenPush_Settings::get();
		if ( '' !== $settings['app_id'] ) {
			return;
		}
		printf(
			'<div class="notice notice-info"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'OpenPush needs your App ID to start.', 'openpush' ),
			esc_url( self::page_url() ),
			esc_html__( 'Add it', 'openpush' )
		);
	}

	/**
	 * Renders the page.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}
		$settings = OpenPush_Settings::get();
		$key      = OpenPush_Settings::rest_api_key();
		$custom   = ! OpenPush_Settings::is_default_server( $settings['server'] );
		$worker   = OpenPush_Worker::location( $settings['server'] );
		$check    = get_option( OpenPush_Settings::CHECK_OPTION );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'OpenPush', 'openpush' ); ?></h1>
			<p><?php esc_html_e( 'Web push for this site. Prompts, the welcome notification and click behaviour are set in the OpenPush console.', 'openpush' ); ?></p>

			<?php if ( $custom && ! $worker['ready'] ) : ?>
				<div class="notice notice-warning inline"><p><?php esc_html_e( "The worker file for your server couldn't be written to the uploads folder. Make that folder writable, then save again.", 'openpush' ); ?></p></div>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="openpush_save">
				<?php wp_nonce_field( 'openpush_save', 'openpush_save_nonce', false ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="openpush-app-id"><?php esc_html_e( 'App ID', 'openpush' ); ?></label></th>
						<td>
							<input type="text" id="openpush-app-id" name="openpush[app_id]" class="regular-text" value="<?php echo esc_attr( $settings['app_id'] ); ?>" autocomplete="off" spellcheck="false">
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="openpush-site-key"><?php esc_html_e( 'Site key', 'openpush' ); ?></label></th>
						<td>
							<input type="text" id="openpush-site-key" name="openpush[site_key]" class="regular-text" value="<?php echo esc_attr( $settings['site_key'] ); ?>" autocomplete="off" spellcheck="false">
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="openpush-rest-key"><?php esc_html_e( 'REST API key', 'openpush' ); ?></label></th>
						<td>
							<input type="password" id="openpush-rest-key" name="openpush[rest_api_key]" class="regular-text" value="" autocomplete="new-password" spellcheck="false" aria-describedby="openpush-rest-key-hint">
							<p class="description" id="openpush-rest-key-hint">
								<?php
								if ( '' !== $key ) {
									printf(
										/* translators: %s: the last four characters of the saved key. */
										esc_html__( 'Saved, ending in %s. Leave blank to keep it.', 'openpush' ),
										esc_html( OpenPush_Settings::key_ending( $key ) )
									);
								} else {
									esc_html_e( 'Optional. Only needed to send a push when you publish a post.', 'openpush' );
								}
								?>
							</p>
							<?php if ( '' !== $key ) : ?>
								<p><label><input type="checkbox" name="openpush[remove_rest_api_key]" value="1"> <?php esc_html_e( 'Remove the saved key', 'openpush' ); ?></label></p>
							<?php endif; ?>
						</td>
					</tr>
				</table>

				<details<?php echo $custom ? ' open' : ''; ?>>
					<summary><strong><?php esc_html_e( 'Advanced', 'openpush' ); ?></strong></summary>
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><label for="openpush-server"><?php esc_html_e( 'Server', 'openpush' ); ?></label></th>
							<td>
								<input type="url" id="openpush-server" name="openpush[server]" class="regular-text code" value="<?php echo esc_attr( $settings['server'] ); ?>" spellcheck="false" aria-describedby="openpush-server-hint">
								<p class="description" id="openpush-server-hint"><?php esc_html_e( 'Change only if you run your own OpenPush server.', 'openpush' ); ?></p>
							</td>
						</tr>
					</table>
				</details>

				<?php submit_button( __( 'Save changes', 'openpush' ) ); ?>
			</form>

			<h2><?php esc_html_e( 'Connection', 'openpush' ); ?></h2>
			<?php if ( is_array( $check ) && isset( $check['type'], $check['message'], $check['at'] ) ) : ?>
				<div class="notice notice-<?php echo esc_attr( self::notice_class( $check['type'] ) ); ?> inline">
					<p>
						<?php echo esc_html( $check['message'] ); ?>
						<span class="description">
							<?php
							printf(
								/* translators: %s: how long ago, for example "5 minutes". */
								esc_html__( 'Checked %s ago.', 'openpush' ),
								esc_html( human_time_diff( (int) $check['at'] ) )
							);
							?>
						</span>
					</p>
				</div>
			<?php else : ?>
				<p><?php esc_html_e( 'Check that this site and your OpenPush app match.', 'openpush' ); ?></p>
			<?php endif; ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="openpush_check">
				<?php wp_nonce_field( 'openpush_check', 'openpush_check_nonce', false ); ?>
				<?php submit_button( __( 'Check connection', 'openpush' ), 'secondary', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * The WordPress notice class for a result type.
	 *
	 * @param string $type `success`, `warning`, `info` or `error`.
	 * @return string
	 */
	private static function notice_class( $type ) {
		return in_array( $type, array( 'success', 'warning', 'info', 'error' ), true ) ? $type : 'info';
	}

	/**
	 * Stops unless the request comes from an admin.
	 *
	 * @return void
	 */
	private static function require_admin() {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( "You can't change these settings.", 'openpush' ), '', array( 'response' => 403 ) );
		}
	}

	/**
	 * Saves the settings form.
	 *
	 * @return void
	 */
	public static function handle_save() {
		self::require_admin();
		check_admin_referer( 'openpush_save', 'openpush_save_nonce' );
		$input   = isset( $_POST['openpush'] ) && is_array( $_POST['openpush'] ) ? wp_unslash( $_POST['openpush'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- each value is sanitized below.
		$current = OpenPush_Settings::get();
		$next    = $current;

		$app_id = isset( $input['app_id'] ) ? sanitize_text_field( $input['app_id'] ) : '';
		if ( '' === $app_id || '' !== OpenPush_Settings::sanitize_app_id( $app_id ) ) {
			$next['app_id'] = OpenPush_Settings::sanitize_app_id( $app_id );
		} else {
			add_settings_error( 'openpush', 'app_id', __( "That App ID doesn't look right. Copy it from the OpenPush console.", 'openpush' ) );
		}

		$site_key = isset( $input['site_key'] ) ? sanitize_text_field( $input['site_key'] ) : '';
		if ( '' === $site_key || '' !== OpenPush_Settings::sanitize_key( $site_key ) ) {
			$next['site_key'] = OpenPush_Settings::sanitize_key( $site_key );
		} else {
			add_settings_error( 'openpush', 'site_key', __( "That site key doesn't look right. Copy it from the OpenPush console.", 'openpush' ) );
		}

		$server = isset( $input['server'] ) ? sanitize_text_field( $input['server'] ) : '';
		if ( '' === $server ) {
			$next['server'] = OpenPush_Settings::DEFAULT_SERVER;
		} elseif ( '' !== OpenPush_Settings::sanitize_server( $server ) ) {
			$next['server'] = OpenPush_Settings::sanitize_server( $server );
		} else {
			add_settings_error( 'openpush', 'server', __( 'Use a server address that starts with https://', 'openpush' ) );
		}

		$rest_key = isset( $input['rest_api_key'] ) ? sanitize_text_field( $input['rest_api_key'] ) : '';
		if ( ! empty( $input['remove_rest_api_key'] ) ) {
			OpenPush_Settings::save_rest_api_key( '' );
		} elseif ( '' !== $rest_key ) {
			if ( '' !== OpenPush_Settings::sanitize_key( $rest_key ) ) {
				OpenPush_Settings::save_rest_api_key( OpenPush_Settings::sanitize_key( $rest_key ) );
			} else {
				add_settings_error( 'openpush', 'rest_api_key', __( "That REST API key doesn't look right. Copy it from the OpenPush console.", 'openpush' ) );
			}
		}

		OpenPush_Settings::save( $next );
		if ( $next !== $current ) {
			delete_option( OpenPush_Settings::CHECK_OPTION );
		}
		if ( ! OpenPush_Settings::is_default_server( $next['server'] ) && ! OpenPush_Worker::write_custom( $next['server'] ) ) {
			add_settings_error( 'openpush', 'worker', __( "The worker file for your server couldn't be written to the uploads folder.", 'openpush' ) );
		} elseif ( OpenPush_Settings::is_default_server( $next['server'] ) ) {
			OpenPush_Worker::remove_custom();
		}
		if ( ! get_settings_errors( 'openpush' ) ) {
			add_settings_error( 'openpush', 'saved', __( 'Settings saved.', 'openpush' ), 'success' );
		}

		// The same hand-back WordPress's own options form uses: Settings pages show these errors.
		set_transient( 'settings_errors', get_settings_errors(), 30 );
		wp_safe_redirect( self::page_url( array( 'settings-updated' => 'true' ) ) );
		exit;
	}

	/**
	 * Runs "Check connection" and keeps the result.
	 *
	 * @return void
	 */
	public static function handle_check() {
		self::require_admin();
		check_admin_referer( 'openpush_check', 'openpush_check_nonce' );
		$result       = OpenPush_Connection::check( OpenPush_Settings::get(), OpenPush_Settings::origin_of( home_url( '/' ) ) );
		$result['at'] = time();
		delete_option( OpenPush_Settings::CHECK_OPTION );
		add_option( OpenPush_Settings::CHECK_OPTION, $result, '', false );
		wp_safe_redirect( self::page_url() );
		exit;
	}
}
