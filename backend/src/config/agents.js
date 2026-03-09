import dotenv from 'dotenv';
dotenv.config();

export const AGENT_CATALOG = {
    job_description_generator: {
        tenantId: process.env.JD_AGENT_TENANT_ID || 'replace-with-jd-tenant-id',
        configName: process.env.JD_AGENT_CONFIG_NAME || 'NMS Recruitment - JDG',
        isActive: process.env.JD_AGENT_ACTIVE !== 'false'
    },
    job_ad_creator: {
        tenantId: process.env.AD_AGENT_TENANT_ID || '662b3713ca2d41d89f0ffe5c6437f660',
        configName: process.env.AD_AGENT_CONFIG_NAME || 'NMS Recruitment - JAC',
        isActive: process.env.AD_AGENT_ACTIVE !== 'false'
    }
};

export const AGENT_API_BASE_URL = process.env.AGENT_API_BASE_URL || 'http://localhost:8080';
