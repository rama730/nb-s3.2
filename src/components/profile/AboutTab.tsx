"use client";

import BioSection from "./sections/BioSection";
import SkillsSection from "./sections/SkillsSection";
import ExperienceSection from "./sections/ExperienceSection";
import EducationSection from "./sections/EducationSection";
import CertificationsSection from "./sections/CertificationsSection";
import AchievementsSection from "./sections/AchievementsSection";
import PublicationsSection from "./sections/PublicationsSection";
import LanguagesSection from "./sections/LanguagesSection";
import VolunteeringSection from "./sections/VolunteeringSection";
import ProjectsSection from "./sections/ProjectsSection";
import FeaturedSection from "./sections/FeaturedSection";
import type { Profile } from "@/lib/db/schema";

interface AboutTabProps {
    profile: Profile;
    isOwner: boolean;
}

export default function AboutTab({ profile, isOwner }: AboutTabProps) {
    return (
        <div className="space-y-6">
            {/* Featured Section */}
            <FeaturedSection profile={profile} isOwner={isOwner} />

            {/* Bio Section */}
            <BioSection profile={profile} isOwner={isOwner} />

            {/* Skills Section */}
            <SkillsSection profile={profile} isOwner={isOwner} />

            {/* Experience Section */}
            <ExperienceSection profile={profile} isOwner={isOwner} />

            {/* Education Section */}
            <EducationSection profile={profile} isOwner={isOwner} />

            {/* Certifications Section */}
            <CertificationsSection profile={profile} isOwner={isOwner} />

            {/* Achievements Section */}
            <AchievementsSection profile={profile} isOwner={isOwner} />

            {/* Publications Section */}
            <PublicationsSection profile={profile} isOwner={isOwner} />

            {/* Languages Section */}
            <LanguagesSection profile={profile} isOwner={isOwner} />

            {/* Volunteering Section */}
            <VolunteeringSection profile={profile} isOwner={isOwner} />

            {/* Projects Section */}
            <ProjectsSection profile={profile} isOwner={isOwner} />
        </div>
    );
}
