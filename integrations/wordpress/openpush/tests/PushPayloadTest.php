<?php
/**
 * The publish push body, its idempotency key and the answers.
 *
 * @package OpenPush
 */

use PHPUnit\Framework\TestCase;

final class PushPayloadTest extends TestCase {

	private function post( array $over = array() ) {
		return array_merge(
			array(
				'title'          => 'Season 3 is live',
				'excerpt'        => 'New maps &amp; <b>new</b> heroes.',
				'content'        => '<p>Long content</p>',
				'permalink'      => 'https://example.com/season-3/',
				'image'          => 'https://example.com/wp-content/uploads/hero.jpg',
				'custom_title'   => '',
				'custom_message' => '',
				'site_name'      => 'Example',
			),
			$over
		);
	}

	public function test_builds_a_website_push_from_the_post() {
		$this->assertSame(
			array(
				'name'      => 'Season 3 is live',
				'title'     => 'Season 3 is live',
				'deep_link' => 'https://example.com/season-3/',
				'target'    => array( 'platforms' => array( 'web' ) ),
				'body'      => 'New maps & new heroes.',
				'image_url' => 'https://example.com/wp-content/uploads/hero.jpg',
			),
			OpenPush_Push_Payload::build( $this->post() )
		);
	}

	public function test_targets_only_the_platform_never_a_list_of_people() {
		$body = OpenPush_Push_Payload::build( $this->post() );
		$this->assertSame( array( 'platforms' => array( 'web' ) ), $body['target'] );
		$this->assertArrayNotHasKey( 'include_segments', $body );
		$this->assertArrayNotHasKey( 'filters', $body );
	}

	public function test_typed_title_and_message_win() {
		$body = OpenPush_Push_Payload::build(
			$this->post(
				array(
					'custom_title'   => 'Play now',
					'custom_message' => 'Tap to join',
				)
			)
		);
		$this->assertSame( 'Play now', $body['title'] );
		$this->assertSame( 'Tap to join', $body['body'] );
	}

	public function test_falls_back_to_content_words_then_site_name() {
		$words = implode( ' ', array_fill( 0, 40, 'word' ) );
		$body  = OpenPush_Push_Payload::build(
			$this->post(
				array(
					'title'   => '',
					'excerpt' => '',
					'content' => '<p>' . $words . '</p>[gallery ids="1,2"]',
				)
			)
		);
		$this->assertSame( 'Example', $body['title'] );
		$this->assertSame( implode( ' ', array_fill( 0, 30, 'word' ) ) . "\u{2026}", $body['body'] );
	}

	public function test_leaves_out_an_empty_body_and_a_non_https_image() {
		$body = OpenPush_Push_Payload::build(
			$this->post(
				array(
					'excerpt' => '',
					'content' => '',
					'image'   => 'http://example.com/hero.jpg',
				)
			)
		);
		$this->assertArrayNotHasKey( 'body', $body );
		$this->assertArrayNotHasKey( 'image_url', $body );
	}

	public function test_cuts_long_text_with_an_ellipsis() {
		$out = OpenPush_Push_Payload::clean( str_repeat( 'é', 250 ), 200 );
		$this->assertSame( 200, mb_strlen( $out ) );
		$this->assertStringEndsWith( "\u{2026}", $out );
		$this->assertSame( 'a b', OpenPush_Push_Payload::clean( "<script>x</script>a\n\n b", 10 ) );
	}

	public function test_idempotency_key_is_per_site_and_post() {
		$key = OpenPush_Push_Payload::idempotency_key( 'https://example.com/', 42 );
		$this->assertMatchesRegularExpression( '/^wp-[0-9a-f]{12}-42$/', $key );
		$this->assertGreaterThanOrEqual( 16, strlen( $key ) );
		$this->assertSame( $key, OpenPush_Push_Payload::idempotency_key( 'https://example.com/', 42 ) );
		$this->assertNotSame( $key, OpenPush_Push_Payload::idempotency_key( 'https://other.example.com/', 42 ) );
		$this->assertNotSame( $key, OpenPush_Push_Payload::idempotency_key( 'https://example.com/', 43 ) );
	}

	public function test_interprets_the_answers() {
		$sent = OpenPush_Push_Payload::interpret(
			200,
			array(
				'id'                => 'm1',
				'status'            => 'Sent',
				'provider_accepted' => 1200,
			)
		);
		$this->assertTrue( $sent['ok'] );
		$this->assertSame( 'Push sent to 1,200 browsers.', $sent['message'] );
		$this->assertSame( 'Push sent to 1 browser.', OpenPush_Push_Payload::interpret( 200, array( 'provider_accepted' => 1 ) )['message'] );
		$this->assertSame( 'Push sent.', OpenPush_Push_Payload::interpret( 200, null )['message'] );

		$approval = OpenPush_Push_Payload::interpret( 202, array( 'status' => 'pending_approval' ) );
		$this->assertTrue( $approval['ok'] );
		$this->assertSame( 'info', $approval['type'] );

		$this->assertFalse( OpenPush_Push_Payload::interpret( 404, array() )['ok'] );
		$this->assertTrue( OpenPush_Push_Payload::interpret( 409, array() )['ok'] );
		$this->assertSame( 'error', OpenPush_Push_Payload::interpret( 401, null )['type'] );
		$this->assertSame( 'error', OpenPush_Push_Payload::interpret( 403, null )['type'] );
		$this->assertSame( 'Push not sent: deep_link must be https', OpenPush_Push_Payload::interpret( 400, array( 'detail' => 'deep_link must be https' ) )['message'] );
		$this->assertSame( 'Push not sent: OpenPush refused it.', OpenPush_Push_Payload::interpret( 400, array( 'detail' => array( array( 'loc' => 'x' ) ) ) )['message'] );
		$this->assertFalse( OpenPush_Push_Payload::interpret( 0, null )['ok'] );
		$this->assertFalse( OpenPush_Push_Payload::interpret( 503, null )['ok'] );
	}
}
