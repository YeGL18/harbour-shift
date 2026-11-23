require 'xcodeproj'

path = File.join(__dir__, 'HarbourShiftQA.xcodeproj')
project = Xcodeproj::Project.new(path)
target = project.new_target(:ui_test_bundle, 'HarbourShiftUITests', :ios, '16.4')
file = project.main_group.new_file('HarbourShiftUITests.swift')
target.source_build_phase.add_file_reference(file)
target.build_configurations.each do |configuration|
  configuration.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.ygl100.harbourshift.qa'
  configuration.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  configuration.build_settings['SWIFT_VERSION'] = '5.0'
  configuration.build_settings['TARGETED_DEVICE_FAMILY'] = '1'
  configuration.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
  configuration.build_settings['ONLY_ACTIVE_ARCH'] = 'YES'
  configuration.build_settings['ARCHS'] = 'arm64'
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.test_action.build_configuration = 'Debug'
scheme.save_as(path, 'HarbourShiftQA', true)
