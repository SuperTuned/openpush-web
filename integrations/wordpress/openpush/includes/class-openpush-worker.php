<?php
/**
 * The worker file and where it lives.
 *
 * With the OpenPush server the plugin serves the file that ships in its own `worker/` folder: a
 * plain static file, so it works on any host that serves the plugin's other files, needs no
 * rewrite rule and writes nothing. The worker's scope is that folder. A push and its click work
 * whatever the scope is, and a scope that covers no pages never clashes with a site's own worker
 * at `/`.
 *
 * A self-hosted server needs its own address in the file, so the plugin writes that one file to
 * `uploads/openpush/` (the folder WordPress keeps writable) and uses that folder as the scope.
 *
 * @package OpenPush
 */

defined( 'ABSPATH' ) || exit;

/**
 * Builds the worker file body and finds its path and scope.
 */
final class OpenPush_Worker {

	/** The file name the OpenPush worker code expects. */
	const FILE = 'openpush-sw.js';

	/** Where the server serves the worker code. */
	const SDK_PATH = '/sdk/web/v2/openpush-sw.js';

	/** The folder under uploads for a self-hosted server's worker file. */
	const UPLOADS_FOLDER = 'openpush';

	/**
	 * The file's one line, the same line the SDK's worker command writes.
	 *
	 * @param string $server A sanitized server origin.
	 * @return string
	 */
	public static function body( $server ) {
		return 'importScripts("' . $server . self::SDK_PATH . '");' . "\n";
	}

	/**
	 * The folder of a file path, ending in `/`: the widest scope a worker there may have.
	 *
	 * @param string $path An absolute URL path to the file.
	 * @return string
	 */
	public static function scope_for( $path ) {
		$cut = strrpos( $path, '/' );
		return false === $cut ? '/' : substr( $path, 0, $cut + 1 );
	}

	/**
	 * The path part of a URL, without query or fragment.
	 *
	 * @param string $url A URL.
	 * @return string
	 */
	public static function path_of( $url ) {
		$path = wp_parse_url( (string) $url, PHP_URL_PATH );
		return is_string( $path ) && '' !== $path ? $path : '/';
	}

	/**
	 * The worker's path and scope for the current settings, and whether the file is in place.
	 *
	 * @param string $server A sanitized server origin.
	 * @return array{path: string, scope: string, ready: bool}
	 */
	public static function location( $server ) {
		if ( OpenPush_Settings::is_default_server( $server ) ) {
			$path = self::path_of( plugins_url( 'worker/' . self::FILE, OPENPUSH_FILE ) );
			return array(
				'path'  => $path,
				'scope' => self::scope_for( $path ),
				'ready' => true,
			);
		}
		$uploads = wp_upload_dir( null, false );
		$path    = self::path_of( trailingslashit( $uploads['baseurl'] ) . self::UPLOADS_FOLDER . '/' . self::FILE );
		$file    = trailingslashit( $uploads['basedir'] ) . self::UPLOADS_FOLDER . '/' . self::FILE;
		return array(
			'path'  => $path,
			'scope' => self::scope_for( $path ),
			'ready' => is_readable( $file ) && self::body( $server ) === file_get_contents( $file ), // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a local file.
		);
	}

	/**
	 * Writes the self-hosted server's worker file to uploads. Admin only.
	 *
	 * @param string $server A sanitized server origin that is not the default.
	 * @return bool True when the file is in place.
	 */
	public static function write_custom( $server ) {
		global $wp_filesystem;
		$uploads = wp_upload_dir();
		if ( ! empty( $uploads['error'] ) ) {
			return false;
		}
		$dir = trailingslashit( $uploads['basedir'] ) . self::UPLOADS_FOLDER;
		if ( ! wp_mkdir_p( $dir ) ) {
			return false;
		}
		if ( ! function_exists( 'WP_Filesystem' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		if ( 'direct' !== get_filesystem_method( array(), $dir ) || ! WP_Filesystem() ) {
			return false;
		}
		return (bool) $wp_filesystem->put_contents( $dir . '/' . self::FILE, self::body( $server ), FS_CHMOD_FILE );
	}

	/**
	 * Removes the self-hosted server's worker file and its folder, if they exist.
	 *
	 * @return void
	 */
	public static function remove_custom() {
		$uploads = wp_upload_dir( null, false );
		$dir     = trailingslashit( $uploads['basedir'] ) . self::UPLOADS_FOLDER;
		if ( file_exists( $dir . '/' . self::FILE ) ) {
			wp_delete_file( $dir . '/' . self::FILE );
		}
		if ( is_dir( $dir ) ) {
			@rmdir( $dir ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_system_operations_rmdir -- only when empty; nothing to report.
		}
	}
}
