begin;
select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a7', 'alice@x.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-0000000000b7', 'bob@x.com', '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-0000000000c7', 'carol@x.com', '{"full_name":"Carol"}'),
  ('00000000-0000-0000-0000-0000000000d7', 'dave@x.com', '{"full_name":"Dave"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- G: alice (owner), bob, carol. Dave is in no group. One competition in G with alice and bob joined.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
create temp table g as select id, invite_code from create_group('G');
grant select on g to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select join_group((select invite_code from g));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
select join_group((select invite_code from g));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
create temp table comp as select create_competition((select id from g), 'Race', 'workout_count', current_date + 1, current_date + 3, 'UTC') as id;
grant select on comp to authenticated;
reset role;
insert into competition_participants (competition_id, user_id) values
  ((select id from comp), '00000000-0000-0000-0000-0000000000a7'), ((select id from comp), '00000000-0000-0000-0000-0000000000b7');

-- Group chat
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select lives_ok($$insert into messages (group_id, body) values ((select id from g), 'hi group')$$, 'member posts to group chat');
select throws_ok($$insert into messages (group_id, body) values ((select id from g), '   ')$$, '23514', null, 'blank message rejected');
select throws_ok($$insert into messages (sender_id, group_id, body) values ('00000000-0000-0000-0000-0000000000a7', (select id from g), 'spoof')$$,
  '42501', null, 'cannot post as someone else');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
select is((select count(*)::int from messages where group_id = (select id from g)), 1, 'another member reads group chat');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d7');
select is((select count(*)::int from messages), 0, 'non-member reads nothing');
select throws_ok($$insert into messages (group_id, body) values ((select id from g), 'let me in')$$, '42501', null, 'non-member cannot post to group');

-- Competition chat: joined participants only
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select lives_ok($$insert into messages (competition_id, body) values ((select id from comp), 'go team')$$, 'participant posts to competition chat');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select count(*)::int from messages where competition_id = (select id from comp)), 1, 'participant reads competition chat');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
select is((select count(*)::int from messages where competition_id = (select id from comp)), 0, 'group member who has not joined reads nothing');
select throws_ok($$insert into messages (competition_id, body) values ((select id from comp), 'hey')$$, '42501', null, 'non-participant cannot post');

-- Friend requests
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d7');
select throws_ok($$insert into friendships (requester_id, addressee_id) values (auth.uid(), '00000000-0000-0000-0000-0000000000a7')$$,
  '42501', null, 'stranger cannot send a request');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select throws_ok($$insert into messages (recipient_id, body) values ('00000000-0000-0000-0000-0000000000a7', 'dm')$$, '42501', null, 'no DM before friends');
select lives_ok($$insert into friendships (requester_id, addressee_id) values (auth.uid(), '00000000-0000-0000-0000-0000000000a7')$$, 'group mate sends request');
select lives_ok($$update friendships set status = 'accepted' where addressee_id = '00000000-0000-0000-0000-0000000000a7'$$,
  'requester accepting own request touches no row');
select is((select status from friendships where addressee_id = '00000000-0000-0000-0000-0000000000a7'), 'pending', 'still pending');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select throws_ok($$insert into friendships (requester_id, addressee_id) values (auth.uid(), '00000000-0000-0000-0000-0000000000b7')$$,
  '23505', null, 'reverse duplicate request rejected');
select throws_ok($$update friendships set requester_id = '00000000-0000-0000-0000-0000000000c7'$$, '42501', null, 'cannot rewrite who asked');
select lives_ok($$update friendships set status = 'accepted' where requester_id = '00000000-0000-0000-0000-0000000000b7'$$, 'addressee accepts');

-- DMs
select lives_ok($$insert into messages (recipient_id, body) values ('00000000-0000-0000-0000-0000000000b7', 'hi bob')$$, 'friend sends DM');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select body from messages where recipient_id = auth.uid()), 'hi bob', 'friend reads DM');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
select is((select count(*)::int from messages where recipient_id is not null), 0, 'third party cannot read DM');

-- Profiles stay visible to friends outside a shared group; unfriending hides the thread.
reset role;
delete from group_members where user_id = '00000000-0000-0000-0000-0000000000b7';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select is((select display_name from profiles where id = '00000000-0000-0000-0000-0000000000b7'), 'Bob', 'friend profile visible after leaving group');
select lives_ok($$delete from friendships where '00000000-0000-0000-0000-0000000000b7' in (requester_id, addressee_id)$$, 'unfriend');
select is((select count(*)::int from messages where recipient_id is not null), 0, 'DM thread hidden after unfriending');

select * from finish();
rollback;
