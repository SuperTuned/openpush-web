<?php
/**
 * "Check connection" answers.
 *
 * @package OpenPush
 */

use PHPUnit\Framework\TestCase;

final class ConnectionTest extends TestCase {

	private function settings( array $over = array() ) {
		return array_merge(
			array(
				'app_id'   => 'my-app',
				'site_key' => 'op_sdk_myapp_abcdefgh',
				'server'   => 'https://app.openpush.ai',
			),
			$over
		);
	}

	private function config( array $over = array() ) {
		return array_merge(
			array(
				'app'        => 'my-app',
				'sdk_key'    => 'op_sdk_myapp_abcdefgh',
				'enabled'    => true,
				'site'       => array(
					'origin' => 'https://example.com',
					'name'   => 'Example',
				),
				'setup_type' => 'wordpress',
				'direct'     => array( 'new_registrations' => true ),
			),
			$over
		);
	}

	private function check( $status, $body, array $settings = array() ) {
		return OpenPush_Connection::interpret( $status, $body, $this->settings( $settings ), 'https://example.com' );
	}

	public function test_config_url_encodes_the_app_id() {
		$this->assertSame( 'https://app.openpush.ai/v1/apps/my%20app/webpush-config', OpenPush_Connection::config_url( 'https://app.openpush.ai', 'my app' ) );
	}

	public function test_connected() {
		$this->assertSame(
			array(
				'type'    => 'success',
				'message' => 'Connected to Example on https://example.com.',
			),
			$this->check( 200, $this->config() )
		);
	}

	public function test_server_answers() {
		$this->assertSame( 'error', $this->check( 0, null )['type'] );
		$this->assertStringContainsString( 'App ID', $this->check( 404, null )['message'] );
		$this->assertSame( 'warning', $this->check( 429, null )['type'] );
		$this->assertSame( 'error', $this->check( 500, null )['type'] );
		$this->assertSame( 'error', $this->check( 200, null )['type'] );
	}

	public function test_site_states() {
		$this->assertStringContainsString(
			'off',
			$this->check(
				200,
				array(
					'app'     => 'my-app',
					'enabled' => false,
				)
			)['message']
		);
		$this->assertStringContainsString(
			"isn't set up for a website",
			$this->check(
				200,
				array(
					'app'          => 'my-app',
					'vapid_public' => 'x',
				)
			)['message']
		);
		$this->assertStringContainsString( 'site key', $this->check( 200, $this->config( array( 'sdk_key' => 'op_sdk_other_zzzzzzzz' ) ) )['message'] );
		$this->assertSame( 'success', $this->check( 200, $this->config(), array( 'site_key' => '' ) )['type'] );
	}

	public function test_address_mismatch_names_both_addresses() {
		$result = $this->check( 200, $this->config( array( 'site' => array( 'origin' => 'https://www.example.com' ) ) ) );
		$this->assertSame( 'error', $result['type'] );
		$this->assertStringContainsString( 'https://www.example.com', $result['message'] );
		$this->assertStringContainsString( 'https://example.com', $result['message'] );
	}

	public function test_other_setup_types_and_closed_registrations_warn() {
		$this->assertStringContainsString( 'WordPress', $this->check( 200, $this->config( array( 'setup_type' => 'typical' ) ) )['message'] );
		$this->assertSame( 'warning', $this->check( 200, $this->config( array( 'setup_type' => 'custom' ) ) )['type'] );
		$this->assertSame( 'warning', $this->check( 200, $this->config( array( 'direct' => array( 'new_registrations' => false ) ) ) )['type'] );
	}
}
