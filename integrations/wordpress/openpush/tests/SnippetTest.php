<?php
/**
 * The script URL, the initialize options and the inline snippet.
 *
 * @package OpenPush
 */

use PHPUnit\Framework\TestCase;

final class SnippetTest extends TestCase {

	private function worker() {
		return array(
			'path'  => '/wp-content/plugins/openpush/worker/openpush-sw.js',
			'scope' => '/wp-content/plugins/openpush/worker/',
		);
	}

	public function test_script_url_is_the_v2_path() {
		$this->assertSame( 'https://app.openpush.ai/sdk/web/v2/openpush.js', OpenPush_Snippet::script_url( 'https://app.openpush.ai' ) );
	}

	public function test_default_server_passes_only_app_and_worker() {
		$this->assertSame(
			array(
				'appId'              => 'my-app',
				'serviceWorkerPath'  => '/wp-content/plugins/openpush/worker/openpush-sw.js',
				'serviceWorkerScope' => '/wp-content/plugins/openpush/worker/',
			),
			OpenPush_Snippet::init_options( 'my-app', $this->worker(), 'https://app.openpush.ai', '' )
		);
	}

	public function test_self_hosted_server_and_nonce_are_passed() {
		$options = OpenPush_Snippet::init_options( 'my-app', $this->worker(), 'https://push.example.org', 'abc123==' );
		$this->assertSame( 'https://push.example.org', $options['serverUrl'] );
		$this->assertSame( 'abc123==', $options['nonce'] );
	}

	public function test_inline_queues_initialize_and_cannot_break_out_of_the_script() {
		$inline = OpenPush_Snippet::inline(
			array(
				'appId'             => '</script><script>alert(1)</script>',
				'serviceWorkerPath' => '/wp-content/plugins/openpush/worker/openpush-sw.js',
			)
		);
		$this->assertStringStartsWith( 'window.OpenPushDeferred=window.OpenPushDeferred||[];window.OpenPushDeferred.push(function(OpenPush){return OpenPush.initialize({', $inline );
		$this->assertStringEndsWith( '});});', $inline );
		$this->assertStringNotContainsString( '</script>', $inline );
		$this->assertStringNotContainsString( '<', $inline );
		$this->assertStringContainsString( '"serviceWorkerPath":"/wp-content/plugins/openpush/worker/openpush-sw.js"', $inline );
	}

	public function test_add_nonce_marks_every_script_tag_once() {
		$markup = "<script id=\"openpush-sdk-js-before\">x</script>\n<script src=\"https://app.openpush.ai/sdk/web/v2/openpush.js\" id=\"openpush-sdk-js\" defer data-wp-strategy=\"defer\"></script>"; // phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedScript -- test markup.
		$out    = OpenPush_Snippet::add_nonce( $markup, 'n0nce' );
		$this->assertSame( 2, substr_count( $out, 'nonce="n0nce"' ) );
		$this->assertSame( $out, OpenPush_Snippet::add_nonce( $out, 'other' ) );
		$this->assertSame( $markup, OpenPush_Snippet::add_nonce( $markup, '' ) );
		$this->assertSame( '<scripts>', OpenPush_Snippet::add_nonce( '<scripts>', 'n' ) );
	}

	public function test_sanitize_nonce_allows_base64_only() {
		$this->assertSame( 'aB3+/=_-', OpenPush_Snippet::sanitize_nonce( 'aB3+/=_-' ) );
		$this->assertSame( '', OpenPush_Snippet::sanitize_nonce( '"><script>' ) );
		$this->assertSame( '', OpenPush_Snippet::sanitize_nonce( null ) );
	}
}
