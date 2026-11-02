import { Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog';
import { countSignals } from '@/lib/utils';
import type { DbcFileEntry } from '@/store/derive';

export function DbcInformation({ file }: { file: DbcFileEntry }) {
	const signalCount = countSignals(file.catalog.messages);
	const warnings = file.warnings.filter((warning) => warning.category !== 'unsupported-record');
	const hasOmissions = warnings.some((warning) => warning.category === 'omitted-feature');

	return (
		<Dialog>
			<DialogTrigger
				render={<Button variant="ghost" size="icon" className="text-muted-foreground" />}
				aria-label={`Information about ${file.name}`}
			>
				<Info />
			</DialogTrigger>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="pr-8 break-words">{file.name}</DialogTitle>
					<DialogDescription className={warnings.length ? '' : 'sr-only'}>
						{hasOmissions
							? 'Some signals or decoding settings could not be used.'
							: warnings.length
								? 'Some DBC definitions could not be applied.'
								: 'DBC file information.'}
					</DialogDescription>
				</DialogHeader>
				<dl className="space-y-1 text-muted-foreground">
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Loaded messages</dt>
						<dd className="tabular-nums">{file.catalog.messages.length}</dd>
					</div>
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Loaded signals</dt>
						<dd className="tabular-nums">{signalCount}</dd>
					</div>
				</dl>
				{warnings.length > 0 && (
					<>
						<h3 className="font-medium">
							{warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
						</h3>
						{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users must be able to scroll the warnings */}
						<section className="max-h-[30vh] overflow-auto" tabIndex={0} aria-label="DBC warnings">
							<ul className="space-y-2">
								{warnings.map((warning, index) => (
									<li key={index} className="flex gap-3">
										<span className="shrink-0 text-muted-foreground tabular-nums">
											Line {warning.line}
										</span>
										<span>{warning.message}</span>
									</li>
								))}
							</ul>
						</section>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
