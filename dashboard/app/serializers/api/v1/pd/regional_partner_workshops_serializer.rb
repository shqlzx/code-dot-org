class Api::V1::Pd::RegionalPartnerWorkshopsSerializer < ActiveModel::Serializer
  attributes :id, :name, :group, :workshops, :has_csf, :pl_programs_offered, :applications_principal_approval

  def workshops
    return nil if object.id.nil?

    workshops = object.pd_workshops.future
    workshops = workshops.where(course: @scope[:course]) if @scope.try(:[], :course)
    workshops = workshops.where(subject: @scope[:subject]) if @scope.try(:[], :subject)
    workshops.map do |workshop|
      {
        id: workshop.id,
        dates: workshop.friendly_date_range,
        location: workshop.friendly_location
      }
    end
  end

  def applications_principal_approval
    object.try(:applications_principal_approval) || nil
  end
end
