Pod::Spec.new do |s|
  s.name = 'LeaderboardDatePicker'
  s.version = '1.0.0'
  s.summary = 'Native date and time sheets for Leaderboard'
  s.description = s.summary
  s.license = 'MIT'
  s.author = 'Leaderboard contributors'
  s.homepage = 'https://github.com/GC1M/leaderboard'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/GC1M/leaderboard.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
