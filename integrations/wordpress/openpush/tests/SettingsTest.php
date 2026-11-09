<?php
/**
 * Sanitizers for the settings.
 *
 * @package OpenPush
 */

use PHPUnit\Framework\TestCase;

final class SettingsTest extends TestCase {

	public function test_app_id_keeps_valid_ids_and_drops_the_rest() {
		$this->assertSame( 'example-app', OpenPush_Settings::sanitize_app_id( '  example-app ' ) );
		$this->assertSame( 'App_1.x', OpenPush_Settings::sanitize_app_id( 'App_1.x' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_app_id( 'has space' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_app_id( '<script>' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_app_id( str_repeat( 'a', 101 ) ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_app_id( array( 'x' ) ) );
	}

	public function test_keys_are_url_safe_and_8_to_200_characters() {
		$this->assertSame( 'op_sdk_tower_abcDEF123-_', OpenPush_Settings::sanitize_key( ' op_sdk_tower_abcDEF123-_ ' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_key( 'short' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_key( 'op_sdk "quoted"' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_key( str_repeat( 'k', 201 ) ) );
	}

	public function test_server_is_reduced_to_an_https_origin() {
		$this->assertSame( 'https://push.example.org', OpenPush_Settings::sanitize_server( 'https://Push.Example.org/some/path?q=1#f' ) );
		$this->assertSame( 'https://push.example.org:8443', OpenPush_Settings::sanitize_server( 'https://push.example.org:8443/' ) );
		$this->assertSame( 'https://push.example.org', OpenPush_Settings::sanitize_server( 'https://push.example.org:443' ) );
		$this->assertSame( 'http://localhost:8000', OpenPush_Settings::sanitize_server( 'http://localhost:8000/' ) );
		$this->assertSame( 'http://127.0.0.1', OpenPush_Settings::sanitize_server( 'http://127.0.0.1' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_server( 'http://push.example.org' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_server( 'https://user:pass@push.example.org' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_server( 'javascript:alert(1)' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_server( 'push.example.org' ) );
		$this->assertSame( '', OpenPush_Settings::sanitize_server( 'https://"onmouseover=x' ) );
	}

	public function test_normalize_fills_the_default_server() {
		$this->assertSame(
			array(
				'app_id'   => 'my-app',
				'site_key' => '',
				'server'   => 'https://app.openpush.ai',
			),
			OpenPush_Settings::normalize(
				array(
					'app_id' => 'my-app',
					'server' => 'not a url',
					'extra'  => 'dropped',
				)
			)
		);
	}

	public function test_key_ending_shows_only_the_last_four() {
		$this->assertSame( 'wxyz', OpenPush_Settings::key_ending( 'op_v2_app_abc_wxyz' ) );
		$this->assertSame( '', OpenPush_Settings::key_ending( 'abc' ) );
	}

	public function test_origin_of_drops_default_ports_and_paths() {
		$this->assertSame( 'https://example.com', OpenPush_Settings::origin_of( 'https://EXAMPLE.com:443/blog/' ) );
		$this->assertSame( 'http://example.com:8080', OpenPush_Settings::origin_of( 'http://example.com:8080/' ) );
		$this->assertSame( '', OpenPush_Settings::origin_of( 'ftp://example.com/' ) );
	}
}
