<?php
/**
 * Removes the plugin's options, post data and worker file when the plugin is deleted.
 *
 * @package OpenPush
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Cleans one site.
 *
 * @return void
 */
function openpush_uninstall_site() {
	delete_option( 'openpush_settings' );
	delete_option( 'openpush_rest_api_key' );
	delete_option( 'openpush_last_check' );
	foreach ( array( '_openpush_send', '_openpush_title', '_openpush_message', '_openpush_published', '_openpush_result' ) as $openpush_meta_key ) {
		delete_post_meta_by_key( $openpush_meta_key );
	}
	wp_unschedule_hook( 'openpush_send_post' );

	$openpush_uploads = wp_upload_dir( null, false );
	$openpush_dir     = trailingslashit( $openpush_uploads['basedir'] ) . 'openpush';
	if ( file_exists( $openpush_dir . '/openpush-sw.js' ) ) {
		wp_delete_file( $openpush_dir . '/openpush-sw.js' );
	}
	if ( is_dir( $openpush_dir ) ) {
		@rmdir( $openpush_dir ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_system_operations_rmdir -- only when empty.
	}
}

if ( is_multisite() ) {
	$openpush_site_ids = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);
	foreach ( $openpush_site_ids as $openpush_site_id ) {
		switch_to_blog( $openpush_site_id );
		openpush_uninstall_site();
		restore_current_blog();
	}
} else {
	openpush_uninstall_site();
}
