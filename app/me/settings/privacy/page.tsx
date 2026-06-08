import { SettingsShell } from "../settings-shell";

export default function PrivacyPolicyPage() {
  return (
    <SettingsShell title="隐私政策" lead="新晴小程序隐私政策">
      <article className="note-scrollbar absolute left-[22px] top-[236px] bottom-[44px] w-[346px] overflow-y-auto rounded-[24px] bg-[var(--card-warm)] px-5 py-6 text-[12px] leading-6 text-[var(--body)]">
        <p className="text-right text-[11px] leading-5 text-[var(--muted)]">
          更新日期：2026 年 6 月 8 日
          <br />
          生效日期：2026 年 6 月 8 日
        </p>

        <h2 className="mt-5 text-center text-[16px] font-semibold leading-7 text-[var(--ink)]">
          新晴小程序隐私政策
        </h2>

        <p className="mt-5">
          新晴重视用户的个人信息与隐私保护。本政策适用于你通过新晴小程序及相关服务使用小记、慢慢说、心情日历、我的新晴及意见反馈等功能时，我们对个人信息的处理活动。
        </p>
        <p className="mt-4">
          在使用新晴前，请你仔细阅读并理解本政策。你使用或继续使用新晴服务，即表示你理解并同意我们按照本政策处理相关信息。
        </p>

        <h3 className="mt-6 font-semibold text-[var(--ink)]">一、我们如何收集和使用信息</h3>
        <p className="mt-3">
          为向你提供基础服务，我们可能收集你主动填写或上传的信息，包括小记文字、聊天内容、心情与天气标记、图片或视频选择记录、意见反馈内容。上述信息主要用于记录展示、历史回看、生成新晴观察、处理反馈以及改善产品体验。
        </p>
        <p className="mt-3">
          为保障服务正常运行，我们可能收集设备型号、操作系统、微信小程序运行信息、页面访问记录、点击操作、异常日志等基础信息，用于安全风控、故障排查和统计分析。
        </p>

        <h3 className="mt-6 font-semibold text-[var(--ink)]">二、我们如何使用授权权限</h3>
        <p className="mt-3">
          当你使用添加图片/视频功能时，我们会请求相册或媒体选择权限；当你使用登录、通知提醒等功能时，可能根据微信小程序规则请求手机号、微信登录标识或通知授权。你可以拒绝或撤回授权，未授权不会影响无需该权限的基础功能。
        </p>

        <h3 className="mt-6 font-semibold text-[var(--ink)]">三、信息的保存与保护</h3>
        <p className="mt-3">
          游客模式下，你的内容优先保存在本机。登录后，为实现跨设备同步或账号服务，相关内容可能保存至服务端。我们将按照最小必要原则保存信息，并采取访问控制、加密传输、权限隔离等合理措施保护信息安全。
        </p>

        <h3 className="mt-6 font-semibold text-[var(--ink)]">四、信息的共享、转让与公开披露</h3>
        <p className="mt-3">
          未经你的主动分享或法律法规要求，我们不会公开披露你的小记正文、聊天内容或心情记录。为实现登录、云端同步、安全维护等必要功能，我们可能与提供基础技术服务的合作方共享必要信息，并要求其遵守保密与安全义务。
        </p>

        <h3 className="mt-6 font-semibold text-[var(--ink)]">五、你的个人信息权利</h3>
        <p className="mt-3">
          你有权查询、更正、删除、复制或导出你的个人信息，也可以撤回授权、关闭同步或注销账号。账号注销后，账号资料、云端同步记录及相关服务数据将被清空或匿名化处理，法律法规另有规定的除外。
        </p>

        <h3 className="mt-6 font-semibold text-[var(--ink)]">六、未成年人保护</h3>
        <p className="mt-3">
          新晴不面向未成年人提供服务。若你未满十八周岁，请停止注册、登录或使用新晴。若我们发现相关账号使用者为未成年人，将有权停止提供服务并清除相关数据。
        </p>

        <h3 className="mt-6 font-semibold text-[var(--ink)]">七、本政策的更新</h3>
        <p className="mt-3">
          我们可能根据产品功能、法律法规或运营需要更新本政策。发生重大变更时，我们会在小程序内以适当方式提示你。
        </p>

        <h3 className="mt-6 font-semibold text-[var(--ink)]">八、联系我们</h3>
        <p className="mt-3">
          如你对本政策或个人信息保护事项有疑问、意见或投诉，可以通过“设置 - 意见反馈”联系我们。我们将在收到反馈后尽快处理。
        </p>
      </article>
    </SettingsShell>
  );
}
