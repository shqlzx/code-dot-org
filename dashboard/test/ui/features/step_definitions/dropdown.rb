And /^I drag the play sound block to offset "(\d*), (\d*)"$/ do |dx, dy|
  drag_block_relative(2, dx, dy)
end

And /^I press dropdown number (\d+)$/ do |n|
  dropdown_class = google_blockly? ? 'blocklyDropdownText' : 'blocklyText'
  text = @browser.find_elements(:class, dropdown_class)[n.to_i]
  if @browser.browser == :Safari
    # Safari has an issue detecting SVG elements as interactive.
    # Click mouse in element location using Actions API as a workaround.
    @browser.action.move_to(text).click.perform
  else
    google_blockly? ? text.click : text.find_element(:xpath, '../*[last()]').click
  end
end

Then /^the dropdown is (.*)$/ do |visibility|
  case visibility
  when "visible"
    expected = 'block'
  when "hidden"
    expected = 'none'
  else
    raise "unexpected visibility"
  end
  dropdown_class = google_blockly? ? 'blocklyDropDownDiv' : 'blocklyWidgetDiv'
  element = @browser.find_element(:class, dropdown_class)
  expect(element.attribute('style').match(Regexp.new("display: #{expected}"))).not_to eq(nil)
end

Then /^I select item (\d+) from the dropdown$/ do |n|
  elements = @browser.find_elements(:class, 'goog-menuitem-content')
  elements[n.to_i].click
end

Then /^the dropdown field has text "(.*?)"$/ do |text|
  id_selector = get_id_selector
  # This step definition is only used in dropdown.feature, where the relevant dropdown is on the 15th block.
  element_has_text("[#{id_selector}='15'] .blocklyEditableText", text)
end

And /^I press the image dropdown$/ do
  @browser.execute_script("$('.blocklyRectangularDropdownArrow').parent().siblings().filter('[fill-opacity]').simulate( 'drag', {handle: 'corner', dx: 0, dy: 0, moves: 5});")
end
