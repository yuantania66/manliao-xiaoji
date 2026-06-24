import { VerificationScene } from "@prisma/client";
import { sms } from "tencentcloud-sdk-nodejs";

import { AppError } from "@/lib/errors";

const SmsClient = sms.v20210111.Client;

const SMS_ENDPOINT = "sms.tencentcloudapi.com";

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError("SMS_CONFIG_MISSING", `短信服务配置缺失：${name}`, 500, { env: name });
  }
  return value;
};

const getTemplateId = (scene: VerificationScene) => {
  if (scene === VerificationScene.CANCEL_ACCOUNT) {
    return (
      process.env.TENCENT_SMS_TEMPLATE_ID_CANCEL?.trim() ||
      getRequiredEnv("TENCENT_SMS_TEMPLATE_ID")
    );
  }

  return (
    process.env.TENCENT_SMS_TEMPLATE_ID_LOGIN?.trim() ||
    getRequiredEnv("TENCENT_SMS_TEMPLATE_ID")
  );
};

const getTtlMinutes = () => {
  const value = Number(process.env.SMS_CODE_TTL_MINUTES ?? "5");
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 5;
};

const formatChinaPhone = (phone: string) => (phone.startsWith("+") ? phone : `+86${phone}`);

export const sendVerificationSms = async ({
  phone,
  code,
  scene,
}: {
  phone: string;
  code: string;
  scene: VerificationScene;
}) => {
  if (process.env.APP_ENV !== "production") {
    return { provider: "dev" as const };
  }

  const client = new SmsClient({
    credential: {
      secretId: getRequiredEnv("TENCENTCLOUD_SECRET_ID"),
      secretKey: getRequiredEnv("TENCENTCLOUD_SECRET_KEY"),
    },
    region: process.env.TENCENT_SMS_REGION?.trim() || "ap-guangzhou",
    profile: {
      httpProfile: {
        endpoint: SMS_ENDPOINT,
        reqTimeout: 10,
      },
    },
  });

  try {
    const response = await client.SendSms({
      PhoneNumberSet: [formatChinaPhone(phone)],
      SmsSdkAppId: getRequiredEnv("TENCENT_SMS_SDK_APP_ID"),
      SignName: getRequiredEnv("TENCENT_SMS_SIGN_NAME"),
      TemplateId: getTemplateId(scene),
      TemplateParamSet: [code, String(getTtlMinutes())],
    });

    const status = response.SendStatusSet?.[0];
    if (!status || status.Code !== "Ok") {
      throw new AppError("SMS_SEND_FAILED", "短信验证码发送失败", 502, {
        requestId: response.RequestId,
        providerCode: status?.Code,
        providerMessage: status?.Message,
      });
    }

    return {
      provider: "tencent" as const,
      requestId: response.RequestId,
      serialNo: status.SerialNo,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("SMS_SEND_FAILED", "短信服务暂时不可用", 502);
  }
};
