<?php
/**
 * The worker file body and its scope.
 *
 * @package OpenPush
 */

use PHPUnit\Framework\TestCase;

final class WorkerTest extends TestCase {

	public function test_body_is_the_one_import_line() {
		$this->assertSame(
			"importScripts(\"https://app.openpush.ai/sdk/web/v2/openpush-sw.js\");\n",
			OpenPush_Worker::body( 'https://app.openpush.ai' )
		);
		$this->assertSame(
			"importScripts(\"https://push.example.org:8443/sdk/web/v2/openpush-sw.js\");\n",
			OpenPush_Worker::body( 'https://push.example.org:8443' )
		);
	}

	public function test_shipped_file_matches_the_default_server_body() {
		$this->assertSame(
			OpenPush_Worker::body( OpenPush_Settings::DEFAULT_SERVER ),
			file_get_contents( dirname( __DIR__ ) . '/worker/openpush-sw.js' )
		);
	}

	public function test_scope_is_the_file_folder() {
		$this->assertSame( '/wp-content/plugins/openpush/worker/', OpenPush_Worker::scope_for( '/wp-content/plugins/openpush/worker/openpush-sw.js' ) );
		$this->assertSame( '/', OpenPush_Worker::scope_for( '/openpush-sw.js' ) );
		$this->assertSame( '/', OpenPush_Worker::scope_for( 'openpush-sw.js' ) );
	}

	public function test_path_of_keeps_only_the_path() {
		$this->assertSame( '/blog/wp-content/plugins/openpush/worker/openpush-sw.js', OpenPush_Worker::path_of( 'https://cdn.example.com/blog/wp-content/plugins/openpush/worker/openpush-sw.js?ver=1' ) );
		$this->assertSame( '/', OpenPush_Worker::path_of( 'https://example.com' ) );
	}

	public function test_default_server_uses_the_plugin_folder() {
		$this->assertSame(
			array(
				'path'  => '/wp-content/plugins/openpush/worker/openpush-sw.js',
				'scope' => '/wp-content/plugins/openpush/worker/',
				'ready' => true,
			),
			OpenPush_Worker::location( OpenPush_Settings::DEFAULT_SERVER )
		);
	}
}
